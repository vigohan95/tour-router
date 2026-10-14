/** Tour opener + co-bill markets: intersection of the per-city opener lists, joint heatmaps, the averaged fallback, the compare baseline, the tool and the planner. */
import { beforeEach, describe, expect, it } from "vitest";
import { runOnce } from "@/lib/agent/run";
import { buildTools } from "@/lib/agent/tools";
import { detectIntent } from "@/lib/llm/mock-model";
import { FixtureQloo } from "@/lib/qloo/fixture";
import type { HeatmapParams } from "@/lib/qloo/types";
import { getStore, resetStore } from "@/lib/store";
import { buildItinerary, coBillText, pickPartners, pickTourOpener, rankCities, setAct, tourOpenerCandidates } from "@/lib/tour/actions";
import { baselineCities, compareText, compareWith } from "@/lib/tour/compare";
import type { Partner, Plan, RankedCity } from "@/lib/tour/types";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes", kind: "artist" as const };

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

const opener = (id: string, affinity: number): Partner => ({ entity_id: id, name: id.toUpperCase(), affinity });

async function prepared(cities = 4) {
  const store = getStore();
  const plan = store.plan;
  setAct(plan, act);
  plan.candidates = await rankCities(act, store.policy, {}, fx);
  const top = plan.candidates.filter((c) => !c.noSignal).slice(0, cities).map((c) => c.city);
  for (const c of top) await pickPartners(act, c, store.policy, plan, fx);
  buildItinerary(act, plan, store.policy, { cities: top, startDate: "2027-03-01" });
  return { store, plan, top };
}

describe("tour opener candidates (pure)", () => {
  it("ranks by stops appeared in, then mean affinity", () => {
    const plan = { partners: { A: { openers: [opener("x", 0.9), opener("y", 0.5)] }, B: { openers: [opener("y", 0.7), opener("z", 0.95)] }, C: { openers: [opener("y", 0.6)] } } } as unknown as Plan;
    const r = tourOpenerCandidates(plan, ["A", "B", "C"]);
    expect(r.map((c) => `${c.name}:${c.stopsAppeared}/${c.ofStops}:${c.meanAffinity}`)).toEqual(["Y:3/3:0.6", "Z:1/3:0.95", "X:1/3:0.9"]);
    expect(r[0].cities).toEqual(["A", "B", "C"]);
  });
});

describe("pickTourOpener", () => {
  it("picks the recurring act, keeps locals as alternates and re-scores cities on a joint heatmap per country", async () => {
    const { store, plan, top } = await prepared(4);
    const before = fx.stats.requests;
    const cb = await pickTourOpener(act, plan, store.policy, {}, fx, new Date("2026-10-13T00:00:00Z"));
    // Three countries in the North American ranking -> three joint heatmaps, nothing else.
    expect(fx.stats.requests - before).toBe(3);
    expect(cb.method).toBe("joint");
    expect(cb.ofStops).toBe(4);
    expect(cb.stopsAppeared).toBeGreaterThanOrEqual(1);
    expect(cb.opener.name).toContain("(synthetic)");
    const expected = tourOpenerCandidates(plan, top)[0];
    expect(cb.opener.entity_id).toBe(expected.entity_id);
    expect(cb.alternates.every((a) => a.entity_id !== cb.opener.entity_id)).toBe(true);
    for (const [city, local] of Object.entries(cb.locals)) expect(plan.partners[city].openers[0].name).toBe(local);
    // Every scored candidate gets a joint score and rank; the rows are sorted by joint affinity and carry both ranks.
    const scored = plan.candidates.filter((c) => !c.noSignal);
    expect(scored.every((c) => c.jointScore !== undefined && c.jointRank !== undefined)).toBe(true);
    expect(plan.candidates.filter((c) => c.noSignal).every((c) => c.jointScore === undefined)).toBe(true);
    expect(cb.cities.map((r) => r.joint)).toEqual([...cb.cities.map((r) => r.joint)].sort((a, b) => b - a));
    expect(cb.cities[0].jointRank).toBe(1);
    expect(cb.cities.every((r) => Math.abs(r.delta - (r.joint - r.headliner)) < 1e-6)).toBe(true);
    // The joint map differs from the headliner map (the fixture blends both acts, like the live API does).
    expect(cb.cities.some((r) => r.jointRank !== r.headlinerRank)).toBe(true);
    expect(plan.coBill).toBe(cb);
    const text = coBillText(act, cb);
    expect(text).toContain(`Tour opener: ${cb.opener.name}`);
    expect(text).toContain(`${cb.stopsAppeared} of 4 routed cities`);
    expect(text).toContain("one joint heatmap per country");
    // A runner-up can be forced.
    if (cb.alternates[0]) {
      const alt = await pickTourOpener(act, plan, store.policy, { openerEntityId: cb.alternates[0].entity_id }, fx);
      expect(alt.opener.entity_id).toBe(cb.alternates[0].entity_id);
    }
  });

  it("falls back to averaging two single-signal maps when the API refuses two signals, and says so", async () => {
    const { store, plan } = await prepared(3);
    const strict = { ...fx, mode: "fixture" as const, search: fx.search.bind(fx), insights: fx.insights.bind(fx), heatmap: async (p: HeatmapParams) => (p.signalEntities.length > 1 ? Promise.reject(new Error("Qloo 400: one signal only")) : fx.heatmap(p)) };
    const cb = await pickTourOpener(act, plan, store.policy, {}, strict);
    expect(cb.method).toBe("averaged");
    expect(cb.methodNote).toMatch(/refused a two-signal heatmap/);
    expect(cb.methodNote).toContain("United States");
    expect(cb.cities.length).toBeGreaterThan(0);
    expect(coBillText(act, cb)).toContain("averaged single-signal maps");
  });

  it("needs partners for at least two cities", async () => {
    const store = getStore();
    setAct(store.plan, act);
    store.plan.candidates = await rankCities(act, store.policy, { limit: 3 }, fx);
    await pickPartners(act, store.plan.candidates[0].city, store.policy, store.plan, fx);
    await expect(pickTourOpener(act, store.plan, store.policy, {}, fx)).rejects.toThrow(/at least two/);
  });
});

describe("co-bill baseline", () => {
  it("ranks the baseline on the joint score and reports joint affinity for both routes", async () => {
    const { store, plan, top } = await prepared(4);
    expect(() => compareWith(act, plan, store.policy, "cobill")).toThrow(/tour opener first/);
    await pickTourOpener(act, plan, store.policy, {}, fx);
    const r = compareWith(act, plan, store.policy, "cobill");
    expect(r.against).toBe("cobill");
    expect(r.label).toContain("co-bill route");
    expect(r.baseline.stops).toHaveLength(4);
    const byJoint = plan.candidates.filter((c) => !c.excluded && c.jointScore !== undefined).sort((a, b) => b.jointScore! - a.jointScore!);
    expect(baselineCities(plan.candidates, 2, "cobill")).toEqual(byJoint.slice(0, 2).map((c) => c.city));
    expect(r.avgJointAffinity).toBeDefined();
    // The co-bill route is at least as good on the joint signal as the headliner-only route (it optimises it).
    expect(r.avgJointAffinity!.baseline).toBeGreaterThanOrEqual(r.avgJointAffinity!.plan - 1e-9);
    const text = compareText(r, act.name);
    expect(text).toContain("co-bill route");
    expect(text).toMatch(/joint affinity [\d.]+% vs [\d.]+%/);
    expect(plan.compare?.against).toBe("cobill");
    // Population compare also carries the joint averages once an opener is picked.
    const pop = compareWith(act, plan, store.policy, "population");
    expect(pop.avgJointAffinity).toBeDefined();
    expect(top.length).toBe(4);
    const mk = (city: string, jointScore?: number): RankedCity => ({ city, country: "US", region: "North America", lat: 0, lon: 0, score: 0.5, popularity: 0.5, cells: 1, topCells: [], index: 50, rank: 1, popularityRank: 1, populationRank: 1, lift: 0, jointScore });
    expect(baselineCities([mk("Austin", 0.4), mk("Denver", 0.9), mk("Omaha")], 3, "cobill")).toEqual(["Denver", "Austin"]);
  });
});

describe("tool and planner", () => {
  it("exposes pick_tour_opener as a read-only tool and compare_plans against=cobill picks the opener first", async () => {
    const run = async (name: string, input: unknown) => (await buildTools()[name].execute!(input as never, { toolCallId: "t1", messages: [], context: undefined })) as Record<string, unknown>;
    const store = getStore();
    await run("resolve_artist", { query: "Nova Reyes" });
    await run("rank_cities_by_affinity", { limit: 8 });
    const cities = store.plan.candidates.filter((c) => !c.noSignal).slice(0, 3).map((c) => c.city);
    const early = await run("pick_tour_opener", {});
    expect(String(early.error)).toMatch(/at least two/);
    for (const city of cities) await run("pick_city_partners", { city });
    await run("build_itinerary", { cities });
    const cmp = await run("compare_plans", { against: "cobill" });
    expect(cmp.error).toBeUndefined();
    expect(store.plan.coBill).toBeDefined();
    expect(cmp.avgJointAffinity).toBeDefined();
    const r = await run("pick_tour_opener", {});
    expect((r.opener as { name: string }).name).toBe(store.plan.coBill!.opener.name);
    expect(typeof r.summary).toBe("string");
    expect(store.audit.some((a) => a.tool === "pick_tour_opener" && a.decision === "allowed" && a.rule === "read-only")).toBe(true);
  });

  it("the keyless planner answers 'who should open the whole tour' and 'compare the co-bill route'", async () => {
    expect(detectIntent("Who should open the whole tour?")).toBe("opener");
    expect(detectIntent("pick a tour opener")).toBe("opener");
    expect(detectIntent("Compare the co-bill route")).toBe("compare");
    await runOnce("Plan a 4-city tour for Nova Reyes");
    const who = await runOnce("Who should open the whole tour?");
    expect(who.toolCalls).toEqual(["pick_tour_opener"]);
    expect(who.text).toMatch(/^Tour opener: /);
    expect(getStore().plan.coBill?.ofStops).toBe(4);
    const cmp = await runOnce("Compare the co-bill route");
    expect(cmp.toolCalls).toEqual(["compare_plans"]);
    expect(cmp.text).toContain("co-bill route");
    expect(getStore().plan.compare?.against).toBe("cobill");
  });
});
