/**
 * Promoter inputs as policy fields: blackout dates, held venues, the radius clause and the per-leg cap.
 * Pure rules (schema, dates, legs), the policy engine's denials, the scheduler, the baselines and the rule planner.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runOnce } from "@/lib/agent/run";
import { evaluateAction } from "@/lib/policy/engine";
import { DEFAULT_POLICY, heldFor, isBlackout, parsePolicy } from "@/lib/policy/schema";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { getStore, resetStore } from "@/lib/store";
import { heldVenue, makeItinerary, pickPartners, rankCities } from "@/lib/tour/actions";
import { baselineCities } from "@/lib/tour/compare";
import { legChecks, pairsCloserThan, radiusConflict, respectRadius } from "@/lib/tour/legs";
import { haversineKm, showDates } from "@/lib/tour/route";
import { CITIES, findCity } from "@/lib/tour/cities";
import { emptyPlan, type RankedCity } from "@/lib/tour/types";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes" };
const plan = () => ({ ...emptyPlan("fixture") });
const km = (a: string, b: string) => Math.round(haversineKm(findCity(a)!, findCity(b)!));

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

describe("policy fields", () => {
  it("has promoter-input defaults and validates dates", () => {
    expect(DEFAULT_POLICY).toMatchObject({ blackoutDates: [], heldVenues: [], minKmBetweenStops: 160 });
    expect(DEFAULT_POLICY.maxKmPerLeg).toBeUndefined();
    const p = parsePolicy({ blackoutDates: ["2027-03-05"], heldVenues: [{ city: "denver", venue: "Mission Ballroom", date: "2027-03-12" }], minKmBetweenStops: 300, maxKmPerLeg: 2000 });
    expect(isBlackout(p, "2027-03-05")).toBe(true);
    expect(isBlackout(p, "2027-03-06")).toBe(false);
    expect(heldFor(p, "Denver")).toMatchObject({ venue: "Mission Ballroom", date: "2027-03-12" });
    expect(heldFor(p, "Austin")).toBeUndefined();
    expect(() => parsePolicy({ blackoutDates: ["March 5"] })).toThrow(/yyyy-mm-dd/);
    expect(() => parsePolicy({ heldVenues: [{ city: "Denver", venue: "X", date: "12/03/2027" }] })).toThrow(/yyyy-mm-dd/);
    expect(() => parsePolicy({ minKmBetweenStops: -1 })).toThrow();
  });
});

describe("show dates", () => {
  it("skips blackout dates and keeps the gap away from held dates", () => {
    const start = new Date("2027-03-01T00:00:00Z");
    expect(showDates(start, 3, 2, { blackout: ["2027-03-03"] })).toEqual(["2027-03-01", "2027-03-04", "2027-03-06"]);
    // A blackout on the start date moves the first show too.
    expect(showDates(start, 2, 2, { blackout: ["2027-03-01", "2027-03-02"] })).toEqual(["2027-03-03", "2027-03-05"]);
    // Free dates never land within the gap of a held date (03-05 is held: 03-04 and 03-06 are off limits with gap 2).
    expect(showDates(start, 3, 2, { avoid: ["2027-03-05"] })).toEqual(["2027-03-01", "2027-03-03", "2027-03-07"]);
    expect(showDates(start, 2, 2)).toEqual(["2027-03-01", "2027-03-03"]);
  });
});

describe("legs", () => {
  it("finds pairs inside the radius clause and legs over the cap", () => {
    expect(km("New York", "Philadelphia")).toBeLessThan(160);
    expect(pairsCloserThan([findCity("New York")!, findCity("Philadelphia")!, findCity("Chicago")!], 160)).toEqual([{ a: "New York", b: "Philadelphia", km: km("New York", "Philadelphia") }]);
    expect(pairsCloserThan([findCity("New York")!, findCity("Chicago")!], 160)).toEqual([]);
    const checks = legChecks(["Vancouver", "Miami", "Seattle"], { minKmBetweenStops: 160, maxKmPerLeg: 2000 }, { startCity: "Vancouver" });
    // Routed from Vancouver: Seattle next (close), then Miami (one long leg).
    expect(checks.tooClose).toEqual([]);
    expect(checks.tooFar).toHaveLength(1);
    expect(checks.tooFar[0]).toMatchObject({ a: "Seattle", b: "Miami" });
    // The user's own order is checked as given.
    expect(legChecks(["Vancouver", "Miami", "Seattle"], { minKmBetweenStops: 160, maxKmPerLeg: 2000 }, { keepOrder: true }).tooFar.map((v) => `${v.a}>${v.b}`)).toEqual(["Vancouver>Miami", "Miami>Seattle"]);
    expect(legChecks(["Vancouver", "Miami"], { minKmBetweenStops: 160 }).tooFar).toEqual([]);
  });

  it("keeps a rank-ordered list inside the radius clause, around held anchors", () => {
    expect(respectRadius(["New York", "Philadelphia", "Boston", "Chicago"], 160)).toEqual(["New York", "Boston", "Chicago"]);
    expect(respectRadius(["New York", "Philadelphia"], 0)).toEqual(["New York", "Philadelphia"]);
    expect(respectRadius(["Philadelphia", "Chicago"], 160, ["New York"])).toEqual(["Chicago"]);
    expect(radiusConflict("Philadelphia", ["Chicago", "New York"], 160)).toMatchObject({ b: "New York" });
    expect(radiusConflict("Denver", ["Chicago", "New York"], 160)).toBeUndefined();
  });
});

describe("policy engine", () => {
  it("refuses a route that breaks the radius clause, citing minKmBetweenStops", () => {
    const ev = evaluateAction("build_itinerary", { cities: ["New York", "Philadelphia", "Chicago"] }, { policy: DEFAULT_POLICY, plan: plan() });
    expect(ev).toMatchObject({ decision: "deny", rule: "minKmBetweenStops" });
    expect(ev.reason).toContain("New York and Philadelphia");
    expect(ev.reason).toContain("160 km radius clause");
    const relaxed = parsePolicy({ minKmBetweenStops: 100 });
    expect(evaluateAction("build_itinerary", { cities: ["New York", "Philadelphia", "Chicago"] }, { policy: relaxed, plan: plan() })).toMatchObject({ decision: "allow", rule: "maxCities" });
  });

  it("refuses a leg over maxKmPerLeg, citing the field, on the order the router would take", () => {
    const capped = parsePolicy({ maxKmPerLeg: 2000 });
    const ev = evaluateAction("build_itinerary", { cities: ["Vancouver", "Seattle", "Miami"], startCity: "Vancouver" }, { policy: capped, plan: plan() });
    expect(ev).toMatchObject({ decision: "deny", rule: "maxKmPerLeg" });
    expect(ev.reason).toMatch(/Seattle -> Miami is [\d,]+ km, over your 2,000 km per-leg limit/);
    expect(evaluateAction("build_itinerary", { cities: ["Vancouver", "Seattle", "Portland"] }, { policy: capped, plan: plan() }).decision).toBe("allow");
    // The cap still asks (not denies) when the legs are fine but the count is over maxCities.
    const many = ["Austin", "Denver", "Chicago", "Boston", "Atlanta", "Miami", "Seattle"];
    expect(evaluateAction("build_itinerary", { cities: many }, { policy: parsePolicy({ maxKmPerLeg: 5000 }), plan: plan() })).toMatchObject({ decision: "approve", rule: "maxCities" });
  });
});

describe("scheduler", () => {
  it("pins a held venue to its date, flags HELD, skips blackouts and keeps the gap around the hold", async () => {
    const store = getStore();
    const policy = parsePolicy({ blackoutDates: ["2027-03-03"], heldVenues: [{ city: "Denver", venue: "Mission Ballroom", date: "2027-03-09" }], minGapDays: 2 });
    store.plan.candidates = await rankCities(act, policy, { only: ["Austin", "Dallas", "Denver", "Chicago"] }, fx);
    for (const c of ["Austin", "Dallas", "Denver", "Chicago"]) await pickPartners(act, c, policy, store.plan, fx);
    const it = makeItinerary(act, store.plan, policy, { cities: ["Austin", "Dallas", "Denver", "Chicago"], startCity: "Austin", startDate: "2027-03-01" }, "fixture", new Date("2026-10-10T00:00:00Z"));
    const denver = it.stops.find((s) => s.city === "Denver")!;
    expect(denver.date).toBe("2027-03-09");
    expect(denver.held).toBe(true);
    expect(denver.venue).toMatchObject({ name: "Mission Ballroom", held: true, affinity: 0, detail: expect.stringContaining("promoter hold") });
    // Chronological order, legs recomputed over it, dates never on the blackout and never within 2 days of the hold.
    const dates = it.stops.map((s) => s.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates).not.toContain("2027-03-03");
    expect(dates.filter((d) => ["2027-03-08", "2027-03-10"].includes(d))).toEqual([]);
    expect(it.stops[0].city).toBe("Austin");
    expect(it.stops[0].date).toBe("2027-03-01");
    expect(it.stops.map((s) => s.order)).toEqual([1, 2, 3, 4]);
    expect(it.startDate).toBe(dates[0]);
    expect(it.endDate).toBe(dates[3]);
    expect(it.totalKm).toBe(it.stops.reduce((a, s) => a + s.legKm, 0));
    const others = it.stops.filter((s) => s.city !== "Denver");
    expect(others.every((s) => !s.held && !s.venue?.held)).toBe(true);
  });

  it("matches a held venue to the Qloo venue card when the names overlap", () => {
    const venues = [
      { entity_id: "v1", name: "Harbor Music Hall (synthetic)", affinity: 0.81, explainability: [{ signal: "x", score: 1 }] },
      { entity_id: "v2", name: "The Foundry Ballroom (synthetic)", affinity: 0.7 },
    ];
    expect(heldVenue("foundry ballroom", venues)).toMatchObject({ entity_id: "v2", held: true, affinity: 0.7 });
    expect(heldVenue("Red Rocks", venues)).toMatchObject({ name: "Red Rocks", held: true, affinity: 0 });
    expect(heldVenue("Red Rocks")).toMatchObject({ held: true });
  });
});

describe("baselines and the rule planner obey the radius clause", () => {
  it("drops baseline cities inside the radius clause when asked to", () => {
    const mk = (city: string): RankedCity => ({ city, country: "US", region: "North America", lat: 0, lon: 0, score: 0.5, popularity: 0.5, cells: 1, topCells: [], index: 50, rank: 1, popularityRank: 1, populationRank: 1, lift: 0 });
    const cands = [mk("New York"), mk("Philadelphia"), mk("Chicago"), mk("Boston")];
    expect(baselineCities(cands, 3, "population", undefined, 160)).toEqual(["New York", "Chicago", "Boston"]);
    expect(baselineCities(cands, 3, "population")).toEqual(["New York", "Chicago", "Philadelphia"]);
  });

  it("the keyless planner never proposes two stops inside the radius clause and the itinerary is built", async () => {
    getStore().policy = parsePolicy({ minKmBetweenStops: 600, maxCities: 8 });
    const r = await runOnce("Plan a 6-city North American tour for Nova Reyes");
    const stops = getStore().plan.itinerary!.stops.map((s) => s.city);
    expect(stops).toHaveLength(6);
    for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) expect(km(stops[i], stops[j])).toBeGreaterThanOrEqual(600);
    expect(r.text).toContain("6 stops");
    expect(getStore().audit.some((a) => a.decision === "denied" && a.rule === "minKmBetweenStops")).toBe(false);
    expect(CITIES.length).toBeGreaterThan(60);
  });
});
