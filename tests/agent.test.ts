/**
 * End-to-end agent loop with zero keys: rule planner model + fixture Qloo + real policy gate,
 * through the real AI SDK generateText loop (same wiring as /api/agent).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { agentSetup, runOnce } from "@/lib/agent/run";
import { detectIntent, parseAct, parseCities, parseCount, parseStartCity, parseStartDate } from "@/lib/llm/mock-model";
import { parsePolicy } from "@/lib/policy/schema";
import { getStore, resetStore } from "@/lib/store";

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

describe("rule planner parsing", () => {
  it("reads acts, counts, regions, cities and dates out of plain English", () => {
    expect(parseAct("Plan a 10-city North American tour for Nova Reyes")).toBe("Nova Reyes");
    expect(parseAct("Route Max Ortega through 8 cities in the UK starting in London")).toBe("Max Ortega");
    expect(parseAct("Plan a tour for The Velvet Antlers in Europe")).toBe("The Velvet Antlers");
    expect(parseAct('plan 6 stops for "lowtide"')).toBe("lowtide");
    expect(parseAct("Plan a tour for Kestrel & Co. next spring")).toBe("Kestrel & Co.");
    expect(parseAct("plan for 12 cities")).toBeUndefined();
    expect(parseCount("Plan a 10-city North American tour")).toBe(10);
    expect(parseCount("8 stops please")).toBe(8);
    expect(parseCount("plan a tour")).toBeUndefined();
    expect(parseCities("Skip Phoenix and Las Vegas, keep St. Louis")).toEqual(expect.arrayContaining(["Phoenix", "Las Vegas", "St. Louis"]));
    expect(parseCities("nothing here")).toEqual([]);
    expect(parseStartCity("Route Max Ortega through 8 cities starting in London")).toBe("London");
    expect(parseStartCity("kick off from New York")).toBe("New York");
    expect(parseStartDate("start 2027-03-05")).toBe("2027-03-05");
    expect(parseStartDate("in March 2027")).toBe("2027-03-01");
    expect(parseStartDate("spring 2027")).toBe("2027-04-01");
    expect(parseStartDate("in November", new Date("2026-10-10T00:00:00Z"))).toBe("2026-11-01");
    expect(parseStartDate("in May", new Date("2026-10-10T00:00:00Z"))).toBe("2027-05-01");
  });
  it("detects intents", () => {
    expect(detectIntent("Plan a 10-city North American tour for Nova Reyes")).toBe("plan");
    expect(detectIntent("Why Denver?")).toBe("explain");
    expect(detectIntent("Skip Phoenix and Las Vegas")).toBe("exclude");
    expect(detectIntent("What do we have so far?")).toBe("status");
    expect(detectIntent("hello")).toBe("help");
  });
});

describe("agent loop (no keys)", () => {
  it("plans a tour end to end: resolve -> rank -> partners (parallel) -> itinerary -> summary", async () => {
    const r = await runOnce("Plan a 6-city North American tour for Nova Reyes starting in Chicago in March 2027");
    expect(r.toolCalls[0]).toBe("resolve_artist");
    expect(r.toolCalls[1]).toBe("rank_cities_by_affinity");
    expect(r.toolCalls.filter((t) => t === "pick_city_partners")).toHaveLength(6);
    expect(r.toolCalls.at(-1)).toBe("build_itinerary");
    expect(r.steps).toBe(5); // 4 tool steps + the final text
    const plan = getStore().plan;
    expect(plan.act?.name).toBe("Nova Reyes");
    expect(plan.candidates.length).toBeGreaterThanOrEqual(10);
    expect(plan.itinerary?.stops).toHaveLength(6);
    expect(plan.itinerary?.startDate).toBe("2027-03-01");
    // The named start city is force-included and routed first, whatever its rank.
    expect(plan.itinerary?.stops[0].city).toBe("Chicago");
    expect(r.text).toMatch(/Route for Nova Reyes: 6 stops/);
    expect(r.text).toContain("Why ");
    expect(r.text).toContain("opener:");
  });

  it("skips excluded cities and stays inside the policy", async () => {
    getStore().policy = parsePolicy({ excludeCities: ["New York", "Los Angeles"], maxCities: 4 });
    const r = await runOnce("Plan a 4-city tour for Lowtide");
    const cities = getStore().plan.itinerary!.stops.map((s) => s.city);
    expect(cities).toHaveLength(4);
    expect(cities).not.toContain("New York");
    expect(cities).not.toContain("Los Angeles");
    expect(r.text).toContain("4 stops");
  });

  it("over the city cap: unattended runs stop and explain, interactive runs ask", async () => {
    getStore().policy = parsePolicy({ maxCities: 3 });
    const r = await runOnce("Plan a 5-city tour for DJ Halcyon", { unattended: true });
    expect(r.toolCalls.at(-1)).toBe("build_itinerary");
    expect(getStore().plan.itinerary).toBeUndefined();
    expect(r.text).toMatch(/not built/i);
    expect(getStore().audit.some((a) => a.decision === "approval-required" && a.tool === "build_itinerary" && a.rule === "maxCities")).toBe(true);
    const setup = agentSetup();
    expect(await setup.toolApproval({ toolCall: { toolName: "build_itinerary", input: { cities: ["Austin", "Dallas", "Houston", "Denver"] } } })).toMatchObject({ type: "user-approval" });
    expect(await setup.toolApproval({ toolCall: { toolName: "build_itinerary", input: { cities: ["Austin", "Dallas"] } } })).toMatchObject({ type: "approved" });
    expect(await setup.toolApproval({ toolCall: { toolName: "resolve_artist", input: { query: "x" } } })).toMatchObject({ type: "approved" });
  });

  it("refuses regions outside the policy", async () => {
    const r = await runOnce("Plan a 4-city European tour for DJ Halcyon");
    expect(r.toolCalls).toEqual(["resolve_artist", "rank_cities_by_affinity"]);
    expect(r.text).toMatch(/could not rank cities/i);
    expect(getStore().audit.some((a) => a.decision === "denied" && a.rule === "regions")).toBe(true);
    getStore().policy = parsePolicy({ regions: ["Europe", "UK & Ireland"] });
    const ok = await runOnce("Plan a 4-city European tour for DJ Halcyon");
    expect(getStore().plan.itinerary?.stops.every((s) => ["DE", "FR", "NL", "ES", "IT", "PT", "DK", "SE", "AT", "CZ", "PL", "BE", "CH", "NO", "FI"].includes(s.country))).toBe(true);
    expect(ok.text).toContain("4 stops");
  });

  it("explains and excludes on follow-up turns", async () => {
    await runOnce("Plan a 5-city tour for Max Ortega");
    const first = getStore().plan.itinerary!.stops[0].city;
    const why = await runOnce(`Why ${first}?`);
    expect(why.toolCalls).toEqual(["explain_choice"]);
    expect(why.text).toContain(first);
    expect(why.text).toMatch(/ranked #\d/);
    const drop = await runOnce(`Skip ${first}`);
    expect(drop.toolCalls).toEqual(["exclude_city", "build_itinerary"]);
    const stops = getStore().plan.itinerary!.stops.map((s) => s.city);
    expect(stops).toHaveLength(4);
    expect(stops).not.toContain(first);
    expect(drop.text).toContain("1 of 1 cities excluded");
    const status = await runOnce("What do we have?");
    expect(status.toolCalls).toEqual([]);
    expect(status.text).toContain("Max Ortega");
  });

  it("asks for an act when none is known and helps on nonsense", async () => {
    const r = await runOnce("plan 8 cities");
    expect(r.toolCalls).toEqual([]);
    expect(r.text).toMatch(/Which act/);
    const h = await runOnce("hello there");
    expect(h.text).toContain("Plan a 10-city");
  });
});
