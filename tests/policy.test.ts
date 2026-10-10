import { describe, expect, it } from "vitest";
import { evaluateAction, isReadOnlyTool } from "@/lib/policy/engine";
import { DEFAULT_POLICY, PolicySchema, isExcluded, parsePolicy } from "@/lib/policy/schema";
import { emptyPlan, type Plan } from "@/lib/tour/types";

function planWith(overrides: Partial<Plan> = {}): Plan {
  return { ...emptyPlan("fixture"), ...overrides };
}

const ctx = { policy: DEFAULT_POLICY, plan: planWith() };

describe("policy schema", () => {
  it("has sane defaults and merges partials", () => {
    expect(DEFAULT_POLICY).toMatchObject({ maxCities: 12, budgetPerCity: 30000, regions: ["North America"], venue: { minCapacity: 1500, maxCapacity: 5000 }, approvals: { itinerary: "auto" } });
    const p = parsePolicy({ maxCities: 6, excludeCities: ["Denver"], venue: { maxCapacity: 3000 } });
    expect(p.maxCities).toBe(6);
    expect(p.venue).toEqual({ minCapacity: 1500, maxCapacity: 3000 });
    expect(isExcluded(p, "denver")).toBe(true);
    expect(isExcluded(p, "Austin")).toBe(false);
    expect(() => PolicySchema.parse({ ...DEFAULT_POLICY, maxCities: 0 })).toThrow();
    expect(() => parsePolicy({ regions: ["Mars"] })).toThrow();
  });
});

describe("evaluateAction", () => {
  it("allows read-only tools", () => {
    for (const t of ["resolve_artist", "rank_cities_by_affinity", "explain_choice"]) {
      expect(isReadOnlyTool(t)).toBe(true);
      expect(evaluateAction(t, {}, ctx).decision).toBe("allow");
    }
    expect(isReadOnlyTool("build_itinerary")).toBe(false);
  });

  it("keeps ranking inside the policy's regions", () => {
    expect(evaluateAction("rank_cities_by_affinity", { regions: ["North America"] }, ctx).decision).toBe("allow");
    expect(evaluateAction("rank_cities_by_affinity", { regions: ["Europe"] }, ctx)).toMatchObject({ decision: "deny", rule: "regions" });
    const anywhere = parsePolicy({ regions: [] });
    expect(evaluateAction("rank_cities_by_affinity", { regions: ["Europe"] }, { ...ctx, policy: anywhere }).decision).toBe("allow");
  });

  it("denies partners and itineraries for excluded cities", () => {
    const policy = parsePolicy({ excludeCities: ["Phoenix"] });
    expect(evaluateAction("pick_city_partners", { city: "Austin" }, { ...ctx, policy }).decision).toBe("allow");
    expect(evaluateAction("pick_city_partners", { city: "phoenix" }, { ...ctx, policy })).toMatchObject({ decision: "deny", rule: "excludeCities" });
    expect(evaluateAction("build_itinerary", { cities: ["Austin", "Phoenix"] }, { ...ctx, policy })).toMatchObject({ decision: "deny", reason: expect.stringContaining("Phoenix") });
    const plan = planWith({ candidates: [{ city: "Denver", country: "US", region: "North America", lat: 0, lon: 0, score: 0.5, cells: 1, topCells: [], rank: 1, excluded: true, excludedReason: "played last year" }] });
    expect(evaluateAction("pick_city_partners", { city: "Denver" }, { policy: DEFAULT_POLICY, plan })).toMatchObject({ decision: "deny", rule: "grid.excluded" });
    expect(evaluateAction("build_itinerary", { cities: ["Denver"] }, { policy: DEFAULT_POLICY, plan }).decision).toBe("deny");
  });

  it("asks over the city cap and over the per-city budget, allows inside", () => {
    const cities = Array.from({ length: 13 }, (_, i) => `C${i}`);
    expect(evaluateAction("build_itinerary", { cities }, ctx)).toMatchObject({ decision: "approve", rule: "maxCities" });
    expect(evaluateAction("build_itinerary", { cities: cities.slice(0, 12) }, ctx)).toMatchObject({ decision: "allow", rule: "maxCities" });
    const plan = planWith({ partners: { Austin: { city: "Austin", venues: [], brands: [], openers: [], recommendedVenue: { entity_id: "v", name: "Big Hall", affinity: 0.8, estimatedCostUsd: 40000 }, why: "", mode: "fixture" } } });
    expect(evaluateAction("build_itinerary", { cities: ["Austin", "Dallas"] }, { policy: DEFAULT_POLICY, plan })).toMatchObject({ decision: "approve", rule: "budgetPerCity", reason: expect.stringContaining("Austin") });
    const rich = parsePolicy({ budgetPerCity: 50000 });
    expect(evaluateAction("build_itinerary", { cities: ["Austin", "Dallas"] }, { policy: rich, plan }).decision).toBe("allow");
    const cautious = parsePolicy({ approvals: { itinerary: "ask" } });
    expect(evaluateAction("build_itinerary", { cities: ["Austin"] }, { ...ctx, policy: cautious })).toMatchObject({ decision: "approve", rule: "approvals.itinerary" });
  });

  it("honours always-ask, never-allow and unknown tools", () => {
    const locked = parsePolicy({ approvals: { neverAllow: ["build_itinerary"], alwaysAsk: ["pick_city_partners"] } });
    expect(evaluateAction("build_itinerary", { cities: ["Austin"] }, { ...ctx, policy: locked }).decision).toBe("deny");
    expect(evaluateAction("pick_city_partners", { city: "Austin" }, { ...ctx, policy: locked }).decision).toBe("approve");
    expect(evaluateAction("exclude_city", { city: "Austin" }, ctx).decision).toBe("allow");
    expect(evaluateAction("launch_rockets", {}, ctx)).toMatchObject({ decision: "approve", rule: "default-ask" });
  });
});
