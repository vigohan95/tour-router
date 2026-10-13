/** Counterfactuals: taste route vs population / popularity baselines and vs the previous itinerary. Synthetic data only. */
import { beforeEach, describe, expect, it } from "vitest";
import { buildTools } from "@/lib/agent/tools";
import { parsePolicy } from "@/lib/policy/schema";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { getStore, resetStore } from "@/lib/store";
import { buildItinerary, excludeCity, pickPartners, rankCities, setAct } from "@/lib/tour/actions";
import { CITIES } from "@/lib/tour/cities";
import { baselineCities, comparePlans, compareText, compareWith } from "@/lib/tour/compare";
import type { Itinerary, RankedCity, Stop } from "@/lib/tour/types";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes" };

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

const stop = (order: number, city: string, score: number, opener?: string, brand?: string, legKm = 100): Stop => ({ order, city, country: "US", lat: 0, lon: 0, date: `2027-03-0${order}`, score, legKm: order === 1 ? 0 : legKm, opener: opener ? { entity_id: `o:${opener}`, name: opener, affinity: 0.5 } : undefined, brand: brand ? { entity_id: `b:${brand}`, name: brand, affinity: 0.5 } : undefined });
const itin = (id: string, stops: Stop[]): Itinerary => ({ id, act, stops, totalKm: stops.reduce((a, s) => a + s.legKm, 0), startDate: stops[0].date, endDate: stops.at(-1)!.date, estimatedCostUsd: 0, builtAt: "2026-10-10T00:00:00.000Z", mode: "fixture" });

describe("comparePlans (pure)", () => {
  it("reports swapped cities, affinity / km deltas and partners gained or lost", () => {
    // The same opener in two cities counts once in the diff.
    const taste = itin("taste", [stop(1, "Denver", 0.9, "Juno", "Northline"), stop(2, "Nashville", 0.8, "Cass", "Halo"), stop(3, "Chicago", 0.7, "Rio", "Northline")]);
    const pop = itin("pop", [stop(1, "New York", 0.4, "Mabel", "Halo"), stop(2, "Los Angeles", 0.5), stop(3, "Chicago", 0.7, "Rio", undefined, 400)]);
    const r = comparePlans(taste, pop, "population", new Date("2026-10-10T00:00:00Z"));
    expect(r.swappedIn.map((s) => s.city)).toEqual(["Denver", "Nashville"]);
    expect(r.swappedOut.map((s) => s.city)).toEqual(["New York", "Los Angeles"]);
    expect(r.avgAffinity).toEqual({ plan: 0.8, baseline: 0.533, delta: 0.267 });
    expect(r.totalKm).toEqual({ plan: 200, baseline: 500, delta: -300 });
    expect(r.openers).toEqual({ gained: ["Juno", "Cass"], lost: ["Mabel"] });
    expect(r.brands).toEqual({ gained: ["Northline"], lost: [] });
    const text = compareText(r, "Nova Reyes");
    expect(text).toContain("swaps in Denver, Nashville");
    expect(text).toContain("drops New York, Los Angeles");
    expect(text).toContain("80% vs 53% (+27 pts)");
    expect(text).toContain("-300 km");
    const same = comparePlans(taste, taste, "previous");
    expect(same.swappedIn).toEqual([]);
    expect(compareText(same, "Nova Reyes")).toContain("agree on the cities");
  });

  it("picks baseline cities by metro size or by Qloo popularity, skipping excluded ones", () => {
    const mk = (city: string, popularity: number, excluded?: boolean): RankedCity => ({ city, country: "US", region: "North America", lat: 0, lon: 0, score: 0.5, popularity, cells: 1, topCells: [], index: 50, rank: 1, popularityRank: 1, populationRank: 1, lift: 0, excluded });
    const cands = [mk("Austin", 0.9), mk("New York", 0.2), mk("Los Angeles", 0.3, true), mk("Chicago", 0.6)];
    expect(baselineCities(cands, 2, "population")).toEqual(["New York", "Chicago"]);
    expect(baselineCities(cands, 2, "popularity")).toEqual(["Austin", "Chicago"]);
    expect(CITIES.find((c) => c.name === "New York")!.metroM).toBeGreaterThan(CITIES.find((c) => c.name === "Chicago")!.metroM);
  });
});

describe("compareWith (over the plan)", () => {
  it("builds a population baseline with the same stop count and dates, and differs from the taste route when ranks differ", async () => {
    const store = getStore();
    const plan = store.plan;
    setAct(plan, act);
    plan.candidates = await rankCities(act, store.policy, {}, fx);
    const top = plan.candidates.filter((c) => !c.noSignal).slice(0, 4).map((c) => c.city);
    for (const c of top) await pickPartners(act, c, store.policy, plan, fx);
    buildItinerary(act, plan, store.policy, { cities: top, startDate: "2027-03-01" });
    const r = compareWith(act, plan, store.policy, "population");
    expect(r.baseline.stops).toHaveLength(4);
    expect(r.baseline.startDate).toBe("2027-03-01");
    expect(r.baseline.stops.map((s) => s.city)).toEqual(expect.arrayContaining(["New York"]));
    // The synthetic ranking is not population order, so the sets differ.
    expect(r.swappedIn.length + r.swappedOut.length).toBeGreaterThan(0);
    expect(r.swappedIn.every((s) => top.includes(s.city))).toBe(true);
    expect(r.avgAffinity.delta).toBeGreaterThan(0);
    expect(plan.compare).toBe(r);
    // Baseline cities without fetched partners carry none (nothing invented).
    const unfetched = r.baseline.stops.filter((s) => !top.includes(s.city));
    expect(unfetched.every((s) => !s.venue && !s.opener)).toBe(true);
    expect(() => compareWith(act, plan, store.policy, "previous")).toThrow(/no previous/i);
    // Exclude a routed city, rebuild, compare with the previous route.
    excludeCity(plan, top[0], true, "played last year");
    buildItinerary(act, plan, store.policy, { cities: top.slice(1), startDate: "2027-03-01" });
    const prev = compareWith(act, plan, store.policy, "previous");
    expect(prev.swappedOut.map((s) => s.city)).toEqual([top[0]]);
    expect(prev.swappedIn).toEqual([]);
    expect(prev.baseline.id).not.toBe(plan.itinerary!.id);
  });

  it("is exposed as the read-only compare_plans tool and recorded in the audit log", async () => {
    const run = async (name: string, input: unknown) => (await buildTools()[name].execute!(input as never, { toolCallId: "t1", messages: [], context: undefined })) as Record<string, unknown>;
    const store = getStore();
    store.policy = parsePolicy({ maxCities: 6 });
    await run("resolve_artist", { query: "Nova Reyes" });
    await run("rank_cities_by_affinity", { limit: 8 });
    const cities = store.plan.candidates.filter((c) => !c.noSignal).slice(0, 3).map((c) => c.city);
    for (const city of cities) await run("pick_city_partners", { city });
    await run("build_itinerary", { cities });
    const r = await run("compare_plans", { against: "population" });
    expect(r.error).toBeUndefined();
    expect(r.against).toBe("population");
    expect(typeof r.summary).toBe("string");
    expect(store.plan.compare?.against).toBe("population");
    expect(store.audit.some((a) => a.tool === "compare_plans" && a.decision === "allowed" && a.rule === "read-only")).toBe(true);
    const bad = await run("compare_plans", { against: "previous" });
    expect(String(bad.error)).toMatch(/no previous/i);
  });
});
