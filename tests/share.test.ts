/** Share payload: names and scores only, round-trips through the URL, no entity ids. Provenance: calls recorded, ids redacted. */
import { beforeEach, describe, expect, it } from "vitest";
import { redactParams } from "@/lib/qloo/calls";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { getStore, resetStore, runWithStore } from "@/lib/store";
import { buildItinerary, pickPartners, rankCities, setAct } from "@/lib/tour/actions";
import { compareWith } from "@/lib/tour/compare";
import { buildSharePayload, decodeShare, encodeShare, sharePath, summarizeCalls } from "@/lib/tour/share";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes", kind: "artist" as const };

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

describe("share payload", () => {
  it("round-trips through the URL and carries no entity ids or raw responses", async () => {
    const store = getStore();
    await runWithStore(store, async () => {
      setAct(store.plan, act);
      store.plan.candidates = await rankCities(act, store.policy, {}, fx);
      const cities = store.plan.candidates.filter((c) => !c.noSignal).slice(0, 3).map((c) => c.city);
      for (const c of cities) await pickPartners(act, c, store.policy, store.plan, fx);
      buildItinerary(act, store.plan, store.policy, { cities, startDate: "2027-03-01" });
      compareWith(act, store.plan, store.policy, "population");
    });
    const payload = buildSharePayload(store.plan, store.policy, store.audit, new Date("2026-10-13T00:00:00Z"));
    expect(payload.stops).toHaveLength(3);
    expect(payload.stops[0].venue?.name).toContain("(synthetic)");
    expect(payload.stops[0].venue?.explain?.[0]).toMatchObject({ label: "Nova Reyes" });
    expect(payload.stops[0].lift).toBeTypeOf("number");
    expect(payload.candidates.length).toBeGreaterThan(10);
    expect(payload.compare?.against).toBe("population");
    expect(payload.compare?.baselineStops).toHaveLength(3);
    expect(payload.qloo.calls).toBeGreaterThan(0);
    expect(payload.qloo.endpoints.some((e) => e.type === "urn:heatmap")).toBe(true);
    expect(payload.policy.maxCities).toBe(6);
    const json = JSON.stringify(payload);
    expect(json).not.toContain("entity_id");
    expect(json).not.toContain("fx:artist");
    expect(json).not.toContain("raw");
    const path = sharePath(payload);
    expect(path.startsWith("/t/")).toBe(true);
    expect(path.length).toBeLessThan(12_000);
    expect(decodeShare(path.slice(3))).toEqual(payload);
    // Route params can arrive percent-encoded (`$` -> `%24`).
    expect(decodeShare(encodeURIComponent(path.slice(3)))).toEqual(payload);
    expect(decodeShare("not-a-payload")).toBeUndefined();
    expect(decodeShare(encodeShare({ ...payload, v: 99 }))).toBeUndefined();
  });

  it("refuses to share without an itinerary", () => {
    const store = getStore();
    expect(() => buildSharePayload(store.plan, store.policy, store.audit)).toThrow(/itinerary/);
  });
});

describe("provenance", () => {
  it("records every Qloo call on the plan with redacted entity ids", async () => {
    const store = getStore();
    await runWithStore(store, async () => {
      await fx.search("Nova Reyes");
      await fx.heatmap({ signalEntities: ["4BBEF799-A0C4-4110-AB01-39216993C312"], location: { query: "United States" } });
    });
    expect(store.plan.calls).toHaveLength(2);
    expect(store.plan.calls[0]).toMatchObject({ endpoint: "/search", cached: false, mode: "fixture" });
    expect(store.plan.calls[1].params["signal.interests.entities"]).toBe("4BBEF799...");
    expect(store.plan.calls[1].params["filter.location.query"]).toBe("United States");
    expect(summarizeCalls(store.plan.calls)).toEqual([
      { endpoint: "/search", type: "", params: ["query", "take", "types"], n: 1, cached: 0 },
      { endpoint: "/v2/insights", type: "urn:heatmap", params: ["filter.location.query", "signal.interests.entities"], n: 1, cached: 0 },
    ]);
    expect(redactParams({ "filter.exclude.entities": "4BBEF799-A0C4-4110-AB01-39216993C312,BAF6317A-DF94-4C90-92AE-63F86560C21B", take: "5", "filter.location.query": "Austin" })).toEqual({ "filter.exclude.entities": "4BBEF799...,BAF6317A...", take: "5", "filter.location.query": "Austin" });
  });
});
