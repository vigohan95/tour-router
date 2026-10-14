/** "Why not X?": the negative explanation for an unrouted city, from the rank, the population counterfactual and the policy. */
import { beforeEach, describe, expect, it } from "vitest";
import { runOnce } from "@/lib/agent/run";
import { buildTools } from "@/lib/agent/tools";
import { parsePolicy } from "@/lib/policy/schema";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { getStore, resetStore } from "@/lib/store";
import { buildItinerary, excludeCity, pickPartners, rankCities, setAct } from "@/lib/tour/actions";
import { CITIES, findCity } from "@/lib/tour/cities";
import { baselineCities, compareWith } from "@/lib/tour/compare";
import { respectRadius } from "@/lib/tour/legs";
import { haversineKm } from "@/lib/tour/route";
import { whyNot } from "@/lib/tour/why-not";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes", kind: "artist" as const };

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

async function prepared(n = 4, policy = parsePolicy({})) {
  const store = getStore();
  store.policy = policy;
  const plan = store.plan;
  setAct(plan, act);
  plan.candidates = await rankCities(act, store.policy, {}, fx);
  const pool = plan.candidates.filter((c) => !c.noSignal && !c.excluded).map((c) => c.city);
  const top = respectRadius(pool, policy.minKmBetweenStops).slice(0, n);
  for (const c of top) await pickPartners(act, c, store.policy, plan, fx);
  buildItinerary(act, plan, store.policy, { cities: top, startCity: top[0], startDate: "2027-03-01" });
  return { store, plan, top };
}

describe("whyNot (pure)", () => {
  it("answers from the rank, the cap and the obvious route for a city cut by the stop count", async () => {
    const { store, plan, top } = await prepared(4);
    const routed = new Set(top);
    const next = plan.candidates.find((c) => !c.noSignal && !routed.has(c.city) && !respectRadius([...top, c.city], store.policy.minKmBetweenStops).includes(c.city) === false)!;
    const r = whyNot(plan, store.policy, next.city.toLowerCase());
    expect(r.city).toBe(next.city);
    expect(r.routed).toBe(false);
    expect(r.reasons).toContain("cap");
    expect(r.rule).toBe("maxCities");
    expect(r.lines[0]).toMatch(new RegExp(`^${next.city} ranks #${next.rank} of ${plan.candidates.length} by fan affinity`));
    expect(r.lines.join(" ")).toContain("did not make the cut");
    const obvious = baselineCities(plan.candidates, 4, "population", top[0], store.policy.minKmBetweenStops);
    expect(r.lines.join(" ")).toContain(obvious.includes(next.city) ? "WOULD play" : "would not play it either");
    expect(r.reasons.includes("population-only")).toBe(obvious.includes(next.city));
    // A routed city is not a "why not".
    expect(whyNot(plan, store.policy, top[1])).toMatchObject({ routed: true, reasons: [] });
    expect(whyNot(plan, store.policy, "Atlantis")).toMatchObject({ routed: false, reasons: ["not-ranked"] });
  });

  it("cites the exclude list, the grid exclusion and the radius clause", async () => {
    const { store, plan, top } = await prepared(3, parsePolicy({ excludeCities: ["Phoenix"] }));
    const ex = whyNot(plan, store.policy, "Phoenix");
    expect(ex.reasons).toContain("excluded");
    expect(ex.rule).toBe("excludeCities");
    expect(ex.lines.join(" ")).toContain("excludeCities");
    const other = plan.candidates.find((c) => !c.noSignal && !top.includes(c.city) && c.city !== "Phoenix")!;
    excludeCity(plan, other.city, true, "played last year");
    const grid = whyNot(plan, store.policy, other.city);
    expect(grid.reasons).toContain("excluded");
    expect(grid.rule).toBe("grid.excluded");
    expect(grid.lines.join(" ")).toContain("played last year");
    // Radius: a candidate inside 160 km of a routed stop.
    const near = CITIES.find((c) => !top.includes(c.name) && plan.candidates.some((x) => x.city === c.name && !x.noSignal && !x.excluded) && top.some((t) => haversineKm(findCity(t)!, c) < store.policy.minKmBetweenStops));
    if (near) {
      const r = whyNot(plan, store.policy, near.name);
      expect(r.reasons).toContain("radius");
      expect(r.lines.join(" ")).toMatch(/km from .*, inside the 160 km radius clause \(minKmBetweenStops\)/);
    }
    // An unscored city.
    const unscored = plan.candidates.find((c) => c.noSignal);
    if (unscored) expect(whyNot(plan, store.policy, unscored.city).reasons).toContain("unscored");
    const wide = parsePolicy({ minKmBetweenStops: 5000 });
    const r2 = whyNot(plan, wide, plan.candidates.find((c) => !c.noSignal && !top.includes(c.city) && c.city !== other.city && c.city !== "Phoenix")!.city);
    expect(r2.reasons).toContain("radius");
  });

  it("mentions the last comparison and the co-bill rank when they exist", async () => {
    const { store, plan } = await prepared(3);
    compareWith(act, plan, store.policy, "population");
    const out = plan.compare!.swappedOut[0];
    if (out) {
      const r = whyNot(plan, store.policy, out.city);
      expect(r.lines.join(" ")).toContain("would pick instead");
      expect(r.reasons).toContain("population-only");
    }
  });
});

describe("tool and planner", () => {
  it("explain_choice carries the negative answer for an unrouted city, and 'Why not X?' reaches it", async () => {
    const run = async (name: string, input: unknown) => (await buildTools()[name].execute!(input as never, { toolCallId: "t1", messages: [], context: undefined })) as Record<string, unknown>;
    getStore().policy = parsePolicy({ excludeCities: ["Phoenix"], maxCities: 4 });
    await runOnce("Plan a 3-city tour for Nova Reyes");
    const stops = getStore().plan.itinerary!.stops.map((s) => s.city);
    // Phoenix is excluded by the policy and was not even ranked (the brief ranked only 7 candidates): still an answer.
    expect(getStore().plan.candidates.some((c) => c.city === "Phoenix")).toBe(false);
    const routedAnswer = await run("explain_choice", { city: stops[0] });
    expect(routedAnswer.whyNot).toBeUndefined();
    const r = await run("explain_choice", { city: "Phoenix" });
    expect(String(r.explanation)).toContain("Why not routed:");
    expect((r.whyNot as { reasons: string[] }).reasons).toEqual(["not-ranked", "excluded"]);
    const chat = await runOnce("Why not Phoenix?");
    expect(chat.toolCalls).toEqual(["explain_choice"]);
    expect(chat.text).toContain("never scored");
    expect(chat.text).toContain("exclude list");
    const next = getStore().plan.candidates.find((c) => !c.noSignal && !stops.includes(c.city) && c.city !== "Phoenix")!;
    const chat2 = await runOnce(`Why not ${next.city}?`);
    expect(chat2.text).toContain("Why not routed:");
  });
});
