import { describe, expect, it } from "vitest";
import { FIXTURE_ARTISTS, FixtureQloo, cityAffinity, fixtureArtistId, hash } from "@/lib/qloo/fixture";
import { LiveQloo, heatmapQuery, insightsQuery, parseEntity, parseHeatmapCell } from "@/lib/qloo/live";
import { getQloo, qlooMode, setQloo } from "@/lib/qloo";
import { QlooError } from "@/lib/qloo/types";
import { CITIES, findCity } from "@/lib/tour/cities";

describe("fixture adapter (synthetic, deterministic)", () => {
  const fx = new FixtureQloo();

  it("is deterministic and stable across instances", async () => {
    const a = await fx.search("nova");
    const b = await new FixtureQloo().search("nova");
    expect(a).toEqual(b);
    expect(hash("x")).toBe(hash("x"));
    expect(cityAffinity(fixtureArtistId("Nova Reyes"), findCity("Austin")!)).toBe(cityAffinity(fixtureArtistId("Nova Reyes"), findCity("Austin")!));
  });

  it("finds catalogue acts and synthesises any other name", async () => {
    const hits = await fx.search("Nova Reyes");
    expect(hits[0]).toMatchObject({ entity_id: "fx:artist:nova-reyes", name: "Nova Reyes", types: ["urn:entity:artist"] });
    expect(hits[0].hint).toContain("synthetic");
    const any = await fx.search("Someone Nobody Knows");
    expect(any.some((h) => h.name === "Someone Nobody Knows")).toBe(true);
    expect(await fx.search("   ")).toEqual([]);
    expect(FIXTURE_ARTISTS.length).toBeGreaterThanOrEqual(8);
  });

  it("returns venues with capacity, geo and explainability when asked", async () => {
    const r = await fx.insights({ type: "urn:entity:place", signalEntities: ["fx:artist:nova-reyes"], location: { query: "Austin" }, take: 6, explainability: true });
    expect(r.entities).toHaveLength(6);
    for (const e of r.entities) {
      expect(e.type).toBe("urn:entity:place");
      expect(e.affinity).toBeGreaterThan(0);
      expect(e.affinity).toBeLessThanOrEqual(1);
      expect(e.properties.capacity).toBeTypeOf("number");
      expect(e.geo?.latitude).toBeCloseTo(30.27, 0);
      expect(e.explainability?.[0]).toMatchObject({ signal: "fx:artist:nova-reyes", label: "Nova Reyes" });
      expect(e.properties.synthetic).toBe(true);
    }
    // sorted by affinity, like Qloo
    const aff = r.entities.map((e) => e.affinity);
    expect(aff).toEqual([...aff].sort((a, b) => b - a));
    const noExplain = await fx.insights({ type: "urn:entity:place", signalEntities: ["fx:artist:nova-reyes"], location: { query: "Austin" }, take: 2 });
    expect(noExplain.entities[0].explainability).toBeUndefined();
  });

  it("returns brands and openers, honouring exclusions", async () => {
    const brands = await fx.insights({ type: "urn:entity:brand", signalEntities: ["fx:artist:lowtide"], location: { query: "Chicago" }, take: 4 });
    expect(brands.entities.every((e) => e.type === "urn:entity:brand" && e.properties.category)).toBe(true);
    const openers = await fx.insights({ type: "urn:entity:artist", signalEntities: ["fx:artist:lowtide"], location: { query: "Chicago" }, take: 4, trends: "high", excludeEntities: ["fx:artist:lowtide"] });
    expect(openers.entities.every((e) => e.type === "urn:entity:artist" && e.entity_id !== "fx:artist:lowtide")).toBe(true);
    const ex = await fx.insights({ type: "urn:entity:artist", signalEntities: ["fx:artist:lowtide"], take: 4, excludeEntities: [openers.entities[0].entity_id] });
    expect(ex.entities.map((e) => e.entity_id)).not.toContain(openers.entities[0].entity_id);
  });

  it("builds a heatmap around the requested city with ranks", async () => {
    const hm = await fx.heatmap({ signalEntities: ["fx:artist:dj-halcyon"], location: { query: "Berlin" }, take: 20 });
    expect(hm.cells).toHaveLength(20);
    expect(hm.cells[0].affinity_rank).toBe(1);
    for (const c of hm.cells) {
      expect(Math.abs(c.latitude - 52.52)).toBeLessThan(0.2);
      expect(c.affinity).toBeGreaterThan(0);
    }
    const byPoint = await fx.heatmap({ signalEntities: ["fx:artist:dj-halcyon"], location: { latitude: 52.5, longitude: 13.4 } });
    expect(byPoint.cells[0].latitude).toBeCloseTo(52.5, 0);
  });

  it("home-region acts over-index in their home region", () => {
    const halcyon = fixtureArtistId("DJ Halcyon"); // Europe
    const eu = CITIES.filter((c) => c.region === "Europe").map((c) => cityAffinity(halcyon, c));
    const na = CITIES.filter((c) => c.region === "North America").map((c) => cityAffinity(halcyon, c));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(eu)).toBeGreaterThan(mean(na));
  });
});

describe("live client (request shape, parsing, cache, errors)", () => {
  function fakeFetch(handler: (url: URL, init?: RequestInit) => { status?: number; body: unknown }) {
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const r = handler(url, init);
      const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
      return new Response(text, { status: r.status ?? 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { f, calls };
  }

  it("builds documented query strings", () => {
    expect(insightsQuery({ type: "urn:entity:place", signalEntities: ["A", "B"], location: { query: "Austin" }, tags: ["urn:tag:genre:place:music_venue"], take: 8, explainability: true, trends: "high", excludeEntities: ["X"] })).toEqual({
      "filter.type": "urn:entity:place",
      "signal.interests.entities": "A,B",
      take: "8",
      "filter.location.query": "Austin",
      "filter.tags": "urn:tag:genre:place:music_venue",
      "feature.explainability": "true",
      "bias.trends": "high",
      "filter.exclude.entities": "X",
    });
    expect(heatmapQuery({ signalEntities: ["A"], location: { latitude: 30.27, longitude: -97.74, radiusKm: 25 } })).toEqual({ "filter.type": "urn:heatmap", "signal.interests.entities": "A", take: "50", "filter.location": "POINT(-97.74 30.27)", "filter.location.radius": "25000" });
  });

  it("sends the key header, parses /search and caches identical requests", async () => {
    const { f, calls } = fakeFetch((url) => {
      expect(url.pathname).toBe("/search");
      return { body: { results: [{ entity_id: "E1", name: "Some Act", types: ["urn:entity:artist"], popularity: 0.9, disambiguation: "Band from somewhere" }, { name: "no id" }] } };
    });
    const q = new LiveQloo({ apiKey: "k", fetchImpl: f });
    const hits = await q.search("some act");
    expect(hits).toEqual([expect.objectContaining({ entity_id: "E1", name: "Some Act", popularity: 0.9, hint: "Band from somewhere" })]);
    expect(calls[0].url.origin).toBe("https://hackathon.api.qloo.com");
    expect(calls[0].url.searchParams.get("query")).toBe("some act");
    expect(calls[0].url.searchParams.get("types")).toBe("urn:entity:artist");
    expect((calls[0].init?.headers as Record<string, string>)["X-Api-Key"]).toBe("k");
    await q.search("some act");
    expect(calls).toHaveLength(1);
    expect(q.stats).toMatchObject({ requests: 1, cacheHits: 1 });
  });

  it("parses insights entities with explainability in both documented shapes", () => {
    const mapShape = parseEntity({ entity_id: "P1", name: "Hall", types: ["urn:entity:place"], properties: { geocode: { latitude: 1.5, longitude: 2.5 }, address: "1 Main St" }, query: { affinity: 0.8, explainability: { signal: { interests: { entities: { A: 0.6, B: 0.2 } } } } } }, "urn:entity:place");
    expect(mapShape).toMatchObject({ entity_id: "P1", affinity: 0.8, geo: { latitude: 1.5, longitude: 2.5 }, address: "1 Main St" });
    expect(mapShape.explainability).toEqual([
      { signal: "A", label: undefined, score: 0.6 },
      { signal: "B", label: undefined, score: 0.2 },
    ]);
    const arrShape = parseEntity({ id: "P2", name: "Club", query: { affinity: "0.5", explainability: { signal: { interests: { entities: [{ entity_id: "A", name: "Act", score: 0.4 }] } } } } }, "urn:entity:brand");
    expect(arrShape.type).toBe("urn:entity:brand");
    expect(arrShape.explainability).toEqual([{ signal: "A", label: "Act", score: 0.4 }]);
    expect(parseEntity({ entity_id: "P3", name: "x" }, "urn:entity:artist").explainability).toBeUndefined();
    expect(parseHeatmapCell({ location: { latitude: 1, longitude: 2, geohash: "abc" }, query: { affinity: 0.7, affinity_rank: 0.9, popularity: 0.3 } })).toEqual({ latitude: 1, longitude: 2, geohash: "abc", affinity: 0.7, affinity_rank: 0.9, popularity: 0.3 });
    expect(parseHeatmapCell({ location: {} })).toBeUndefined();
  });

  it("parses a heatmap response end-to-end", async () => {
    const { f } = fakeFetch(() => ({ body: { results: { heatmap: [{ location: { latitude: 30.3, longitude: -97.7 }, query: { affinity: 0.9 } }, { bogus: true }] } } }));
    const q = new LiveQloo({ apiKey: "k", fetchImpl: f });
    const hm = await q.heatmap({ signalEntities: ["A"], location: { query: "Austin" } });
    expect(hm.cells).toEqual([{ latitude: 30.3, longitude: -97.7, geohash: undefined, affinity: 0.9, affinity_rank: undefined, popularity: undefined }]);
  });

  it("surfaces HTTP and JSON errors without inventing data", async () => {
    const { f } = fakeFetch((url) => (url.pathname === "/search" ? { status: 401, body: { error: "bad key" } } : { body: "<html>" }));
    const q = new LiveQloo({ apiKey: "k", fetchImpl: f });
    await expect(q.search("x")).rejects.toMatchObject({ name: "QlooError", status: 401 });
    await expect(q.insights({ type: "urn:entity:artist", signalEntities: ["A"] })).rejects.toBeInstanceOf(QlooError);
    expect(q.stats.errors).toBe(2);
    expect(() => new LiveQloo({ apiKey: "" })).toThrow();
  });

  it("limits concurrency", async () => {
    let active = 0;
    let peak = 0;
    const f = (async (input: RequestInfo | URL) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(JSON.stringify({ results: { heatmap: [] }, u: String(input) }), { status: 200 });
    }) as typeof fetch;
    const q = new LiveQloo({ apiKey: "k", fetchImpl: f, concurrency: 2 });
    await Promise.all(["A", "B", "C", "D", "E"].map((c) => q.heatmap({ signalEntities: [c], location: { query: c } })));
    expect(peak).toBe(2);
    expect(q.stats.requests).toBe(5);
  });
});

describe("adapter selection", () => {
  it("uses fixtures without a key and honours injection", () => {
    expect(qlooMode()).toBe("fixture");
    expect(getQloo().mode).toBe("fixture");
    const injected = new FixtureQloo();
    setQloo(injected);
    expect(getQloo()).toBe(injected);
    setQloo(undefined);
    expect(getQloo()).not.toBe(injected);
  });
});
