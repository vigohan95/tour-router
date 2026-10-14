/** Policy counterfactual: the same brief under policy B (one field changed), rebuilt from the cached ranking, with the decisions that flip. */
import { beforeEach, describe, expect, it } from "vitest";
import { runOnce } from "@/lib/agent/run";
import { buildTools } from "@/lib/agent/tools";
import { parsePolicyChange } from "@/lib/llm/mock-model";
import { DEFAULT_POLICY, parsePolicy } from "@/lib/policy/schema";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { getStore, resetStore } from "@/lib/store";
import { buildItinerary, pickPartners, rankCities, setAct } from "@/lib/tour/actions";
import { compareText, compareWith } from "@/lib/tour/compare";
import { haversineKm } from "@/lib/tour/route";
import { findCity } from "@/lib/tour/cities";
import { applyChange, citiesUnderPolicy, describeValue, policyDiffText } from "@/lib/tour/policy-compare";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes", kind: "artist" as const };
const km = (a: string, b: string) => Math.round(haversineKm(findCity(a)!, findCity(b)!));

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

async function prepared(cities = 4, policy = DEFAULT_POLICY) {
  const store = getStore();
  store.policy = policy;
  const plan = store.plan;
  setAct(plan, act);
  plan.candidates = await rankCities(act, store.policy, {}, fx);
  const top = citiesUnderPolicy(plan, store.policy, { stops: Array.from({ length: cities }) } as never, "excludeCities");
  for (const c of top) await pickPartners(act, c, store.policy, plan, fx);
  buildItinerary(act, plan, store.policy, { cities: top, startCity: top[0], startDate: "2027-03-01" });
  return { store, plan, top };
}

describe("applyChange (pure)", () => {
  it("clones the policy and changes exactly one field; list fields add", () => {
    const b = applyChange(DEFAULT_POLICY, { field: "maxCities", value: 8 });
    expect(b.maxCities).toBe(8);
    expect(DEFAULT_POLICY.maxCities).toBe(6);
    expect({ ...b, maxCities: 6 }).toEqual(DEFAULT_POLICY);
    expect(applyChange(parsePolicy({ excludeCities: ["Austin"] }), { field: "excludeCities", value: "Denver, Austin" }).excludeCities).toEqual(["Austin", "Denver"]);
    expect(applyChange(DEFAULT_POLICY, { field: "blackoutDates", value: ["2027-03-05"] }).blackoutDates).toEqual(["2027-03-05"]);
    expect(() => applyChange(DEFAULT_POLICY, { field: "blackoutDates", value: ["March 5"] })).toThrow(/yyyy-mm-dd/);
    expect(applyChange(DEFAULT_POLICY, { field: "maxKmPerLeg", value: null }).maxKmPerLeg).toBeUndefined();
    expect(applyChange(DEFAULT_POLICY, { field: "maxKmPerLeg", value: 2000 }).maxKmPerLeg).toBe(2000);
    expect(applyChange(DEFAULT_POLICY, { field: "minKmBetweenStops", value: "300" }).minKmBetweenStops).toBe(300);
    expect(() => applyChange(DEFAULT_POLICY, { field: "minKmBetweenStops", value: "lots" })).toThrow(/number/);
    expect(describeValue(DEFAULT_POLICY, "maxKmPerLeg")).toBe("no cap");
    expect(describeValue(DEFAULT_POLICY, "excludeCities")).toBe("none");
  });
});

describe("compareWith against=policy", () => {
  it("city cap 4 -> 6: policy B routes six stops and build_itinerary flips from needs-approval to allowed", async () => {
    const { store, plan } = await prepared(4, parsePolicy({ maxCities: 4 }));
    const r = compareWith(act, plan, store.policy, "policy", { change: { field: "maxCities", value: 6 } });
    expect(r.against).toBe("policy");
    expect(r.policy).toMatchObject({ field: "maxCities", from: "4 cities", to: "6 cities", label: "city cap 4 cities -> 6 cities", stopsA: 4, stopsB: 6 });
    expect(r.baseline.stops).toHaveLength(6);
    expect(r.baseline.startDate).toBe("2027-03-01");
    expect(r.baseline.stops[0].city).toBe(plan.itinerary!.stops[0].city);
    expect(r.swappedIn).toEqual([]);
    expect(r.swappedOut).toHaveLength(2);
    // The six-stop route under B needs approval under A (cap 4) and is allowed under B.
    const six = r.policy!.decisions.find((d) => d.action === "Build a 6-stop itinerary")!;
    expect(six).toMatchObject({ underA: "approve", ruleA: "maxCities", underB: "allow" });
    expect(compareText(r, act.name)).toContain("Under policy B (city cap 4 cities -> 6 cities");
    expect(compareText(r, act.name)).toContain("needs approval under A, allowed under B");
    expect(policyDiffText(r.policy!)).toContain("Policy B = policy A with city cap");
    expect(plan.compare).toBe(r);
  });

  it("excluding a routed city: the stop leaves the route and partners for it are denied under B", async () => {
    const { store, plan, top } = await prepared(4);
    const victim = top[1];
    const r = compareWith(act, plan, store.policy, "policy", { change: { field: "excludeCities", value: [victim] } });
    expect(r.swappedIn.map((s) => s.city)).toEqual([victim]);
    expect(r.swappedOut).toHaveLength(1);
    expect(r.baseline.stops).toHaveLength(4);
    expect(r.baseline.stops.map((s) => s.city)).not.toContain(victim);
    const partners = r.policy!.decisions.find((d) => d.action === `Find partners in ${victim}`)!;
    expect(partners).toMatchObject({ underA: "allow", underB: "deny", ruleB: "excludeCities" });
    const buildA = r.policy!.decisions.find((d) => d.action === "Build a 4-stop itinerary")!;
    expect(buildA).toMatchObject({ underA: "allow", underB: "deny", ruleB: "excludeCities" });
    expect(compareText(r, act.name)).toContain(`${victim}`);
  });

  it("a wider radius clause drops the stops it would forbid and cites minKmBetweenStops", async () => {
    const { store, plan, top } = await prepared(5);
    let closest = Infinity;
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) closest = Math.min(closest, km(top[i], top[j]));
    const r = compareWith(act, plan, store.policy, "policy", { change: { field: "minKmBetweenStops", value: closest + 1 } });
    expect(r.policy!.to).toBe(`${closest + 1} km`);
    const build = r.policy!.decisions.find((d) => d.action === "Build a 5-stop itinerary" && d.underA === "allow")!;
    expect(build).toMatchObject({ underB: "deny", ruleB: "minKmBetweenStops" });
    expect(build.reasonB).toMatch(/km apart, inside your/);
    expect(r.swappedIn.length).toBeGreaterThan(0);
    for (let i = 0; i < r.baseline.stops.length; i++) for (let j = i + 1; j < r.baseline.stops.length; j++) expect(km(r.baseline.stops[i].city, r.baseline.stops[j].city)).toBeGreaterThan(closest);
  });

  it("a blackout date moves the dates, not the cities; an identical policy B is refused", async () => {
    const { store, plan } = await prepared(3);
    const second = plan.itinerary!.stops[1].date;
    const r = compareWith(act, plan, store.policy, "policy", { change: { field: "blackoutDates", value: [second] } });
    expect(r.swappedIn).toEqual([]);
    expect(r.swappedOut).toEqual([]);
    expect(r.baseline.stops.map((s) => s.date)).not.toContain(second);
    expect(r.baseline.stops[1].date > second).toBe(true);
    expect(compareText(r, act.name)).toContain("No decision changes");
    expect(() => compareWith(act, plan, store.policy, "policy", { change: { field: "maxCities", value: 6 } })).toThrow(/identical/);
    expect(() => compareWith(act, plan, store.policy, "policy")).toThrow(/one change/);
  });
});

describe("tool and planner", () => {
  it("compare_plans against=policy with a change, audited as read-only", async () => {
    const run = async (name: string, input: unknown) => (await buildTools()[name].execute!(input as never, { toolCallId: "t1", messages: [], context: undefined })) as Record<string, unknown>;
    const store = getStore();
    await run("resolve_artist", { query: "Nova Reyes" });
    await run("rank_cities_by_affinity", { limit: 10 });
    const cities = citiesUnderPolicy(store.plan, store.policy, { stops: [1, 2, 3] } as never, "excludeCities");
    for (const city of cities) await run("pick_city_partners", { city });
    await run("build_itinerary", { cities });
    const r = await run("compare_plans", { against: "policy", change: { field: "excludeCities", value: [cities[0]] } });
    expect(r.error).toBeUndefined();
    expect((r.policy as { label: string }).label).toContain("excluded cities");
    expect(String(r.summary)).toContain("Under policy B");
    const missing = await run("compare_plans", { against: "policy" });
    expect(String(missing.error)).toMatch(/one change/);
  });

  it("the keyless planner parses 'what if' briefs into one policy change", async () => {
    expect(parsePolicyChange("What if the cap were 8?")).toEqual({ field: "maxCities", value: 8 });
    expect(parsePolicyChange("Compare under policy B with a 300 km radius")).toEqual({ field: "minKmBetweenStops", value: 300 });
    expect(parsePolicyChange("what if I excluded Denver and Austin")).toEqual({ field: "excludeCities", value: ["Denver", "Austin"] });
    expect(parsePolicyChange("what if 2027-03-05 were a blackout day")).toEqual({ field: "blackoutDates", value: ["2027-03-05"] });
    expect(parsePolicyChange("what if no leg could be over 1500 km")).toEqual({ field: "maxKmPerLeg", value: 1500 });
    expect(parsePolicyChange("what if shows were 3 days apart")).toEqual({ field: "minGapDays", value: 3 });
    expect(parsePolicyChange("compare with population")).toBeUndefined();
    getStore().policy = parsePolicy({ maxCities: 4 });
    await runOnce("Plan a 4-city tour for Nova Reyes");
    const r = await runOnce("What if the cap were 6?");
    expect(r.toolCalls).toEqual(["compare_plans"]);
    expect(r.text).toContain("Under policy B (city cap 4 cities -> 6 cities");
    expect(getStore().plan.compare?.policy?.stopsB).toBe(6);
    const pop = await runOnce("Compare with population-only routing");
    expect(getStore().plan.compare?.against).toBe("population");
    expect(pop.text).toContain("population-only");
  });
});
