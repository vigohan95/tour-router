/** The five actions over the fixture adapter, plus the AI SDK tool wrappers' policy re-check and audit. */
import { beforeEach, describe, expect, it } from "vitest";
import { buildTools } from "@/lib/agent/tools";
import { parsePolicy } from "@/lib/policy/schema";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { aggregateHeatmap, buildItinerary, excludeCity, explainChoice, pickPartners, rankCities, resolveArtist, setAct } from "@/lib/tour/actions";
import { getStore, resetStore } from "@/lib/store";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes" };

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

describe("actions", () => {
  it("resolves an act", async () => {
    const r = await resolveArtist("Nova Reyes", fx);
    expect(r.mode).toBe("fixture");
    expect(r.hits[0]).toMatchObject(act);
  });

  it("ranks cities from heatmaps inside the policy regions and flags exclusions", async () => {
    const policy = parsePolicy({ excludeCities: ["Phoenix"] });
    const ranked = await rankCities(act, policy, { limit: 10 }, fx);
    expect(ranked).toHaveLength(10);
    expect(ranked.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(ranked.every((c) => c.region === "North America")).toBe(true);
    const scores = ranked.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(ranked[0].topCells.length).toBeGreaterThan(0);
    const all = await rankCities(act, policy, {}, fx);
    expect(all.find((c) => c.city === "Phoenix")).toMatchObject({ excluded: true, excludedReason: "policy.excludeCities" });
    const only = await rankCities(act, policy, { only: ["Austin", "Dallas", "nowhere"] }, fx);
    expect(only.map((c) => c.city).sort()).toEqual(["Austin", "Dallas"]);
    const eu = await rankCities(act, policy, { regions: ["Europe"], limit: 3 }, fx);
    expect(eu.every((c) => c.region === "Europe")).toBe(true);
    expect(aggregateHeatmap([{ affinity: 0.9 }, { affinity: 0.1 }, { affinity: 0.5 }], 2)).toBe(0.7);
    expect(aggregateHeatmap([])).toBe(0);
  });

  it("picks venues inside the capacity window with explainability and writes a why", async () => {
    const plan = getStore().plan;
    const policy = parsePolicy({ venue: { minCapacity: 1500, maxCapacity: 5000 } });
    plan.candidates = await rankCities(act, policy, { limit: 5 }, fx);
    const city = plan.candidates[0].city;
    const p = await pickPartners(act, city, policy, plan, fx);
    expect(p.city).toBe(city);
    expect(p.venues.length).toBeGreaterThan(0);
    expect(p.recommendedVenue?.capacity).toBeGreaterThanOrEqual(1500);
    expect(p.recommendedVenue?.capacity).toBeLessThanOrEqual(5000);
    expect(p.recommendedVenue?.explainability?.[0].label).toBe("Nova Reyes");
    expect(p.brands.length).toBeGreaterThan(0);
    expect(p.openers.every((o) => o.entity_id !== act.entity_id)).toBe(true);
    expect(p.why).toContain(city);
    expect(p.why).toContain(p.recommendedVenue!.name);
    expect(plan.partners[city]).toBe(p);
    await expect(pickPartners(act, "Atlantis", policy, plan, fx)).rejects.toThrow(/Unknown city/);
  });

  it("builds an itinerary with route order, dates, legs and attached partners", async () => {
    const store = getStore();
    const plan = store.plan;
    plan.candidates = await rankCities(act, store.policy, { limit: 6 }, fx);
    const cities = plan.candidates.slice(0, 5).map((c) => c.city);
    for (const c of cities) await pickPartners(act, c, store.policy, plan, fx);
    const it = buildItinerary(act, plan, store.policy, { cities, startCity: cities[2], startDate: "2027-03-01", gapDays: 3 });
    expect(it.stops).toHaveLength(5);
    expect(it.stops[0].city).toBe(cities[2]);
    expect(it.stops[0].legKm).toBe(0);
    expect(it.stops[1].legKm).toBeGreaterThan(0);
    expect(it.stops.map((s) => s.date)).toEqual(["2027-03-01", "2027-03-04", "2027-03-07", "2027-03-10", "2027-03-13"]);
    expect(it.totalKm).toBe(it.stops.reduce((a, s) => a + s.legKm, 0));
    expect(it.stops.every((s) => s.venue && s.opener && s.brand)).toBe(true);
    expect(it.estimatedCostUsd).toBeGreaterThan(0);
    expect(plan.itinerary).toBe(it);
    expect(() => buildItinerary(act, plan, store.policy, { cities: [] })).toThrow();
    expect(() => buildItinerary(act, plan, store.policy, { cities: ["Atlantis"] })).toThrow(/Unknown city/);
  });

  it("explains a city from rank, partners and route", async () => {
    const store = getStore();
    const plan = store.plan;
    plan.candidates = await rankCities(act, store.policy, { limit: 3 }, fx);
    const city = plan.candidates[0].city;
    expect(() => explainChoice(plan, "Atlantis")).toThrow();
    const before = explainChoice(plan, city.toLowerCase());
    expect(before.explanation).toContain("ranked #1");
    await pickPartners(act, city, store.policy, plan, fx);
    buildItinerary(act, plan, store.policy, { cities: [city] });
    const after = explainChoice(plan, city);
    expect(after.contributions.length).toBeGreaterThan(0);
    expect(after.explanation).toContain("Explainability");
    expect(after.explanation).toContain("Routed as stop 1");
    excludeCity(plan, city, true, "played last year");
    expect(explainChoice(plan, city).explanation).toContain("played last year");
    expect(excludeCity(plan, "Atlantis", true)).toBeUndefined();
  });
});

describe("AI SDK tool wrappers", () => {
  const run = async (name: string, input: unknown) => {
    const t = buildTools()[name];
    return (await t.execute!(input as never, { toolCallId: "t1", messages: [], context: undefined })) as Record<string, unknown>;
  };

  it("resolve -> rank -> partners -> itinerary, auditing each step", async () => {
    const store = getStore();
    const r = await run("resolve_artist", { query: "Nova Reyes" });
    expect(r.selected).toMatchObject(act);
    expect(store.plan.act).toMatchObject(act);
    const ranked = await run("rank_cities_by_affinity", { limit: 4 });
    expect(ranked.count).toBe(4);
    expect(store.plan.candidates).toHaveLength(4);
    const city = store.plan.candidates[0].city;
    const p = await run("pick_city_partners", { city });
    expect(p.city).toBe(city);
    expect(p.recommendedVenue).toBeTruthy();
    const it = await run("build_itinerary", { cities: [city] });
    expect((it.stops as unknown[]).length).toBe(1);
    expect(store.plan.itinerary?.stops[0].city).toBe(city);
    const ex = await run("explain_choice", { city });
    expect(ex.explanation).toContain(city);
    const tools = store.audit.filter((a) => a.actor === "agent").map((a) => a.tool);
    expect(tools).toEqual(expect.arrayContaining(["resolve_artist", "rank_cities_by_affinity", "pick_city_partners", "build_itinerary", "explain_choice"]));
  });

  it("re-checks the policy at execution and returns errors instead of throwing", async () => {
    setAct(getStore().plan, act);
    getStore().policy = parsePolicy({ excludeCities: ["Austin"] });
    const denied = await run("pick_city_partners", { city: "Austin" });
    expect(String(denied.error)).toContain("exclude");
    expect(getStore().audit[0]).toMatchObject({ tool: "pick_city_partners", decision: "error", rule: "excludeCities" });
    const unknown = await run("pick_city_partners", { city: "Atlantis" });
    expect(String(unknown.error)).toContain("Unknown city");
    resetStore();
    const noAct = await run("rank_cities_by_affinity", {});
    expect(String(noAct.error)).toContain("No act selected");
  });

  it("excludes a ranked city", async () => {
    await run("resolve_artist", { query: "Lowtide" });
    await run("rank_cities_by_affinity", { limit: 3 });
    const city = getStore().plan.candidates[1].city;
    expect(await run("exclude_city", { city, excluded: true })).toEqual({ city, excluded: true });
    expect(getStore().plan.candidates[1].excluded).toBe(true);
    expect(String((await run("exclude_city", { city: "Atlantis", excluded: true })).error)).toContain("not in the ranked");
  });
});
