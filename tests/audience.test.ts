/** Audience card: one urn:demographics call per act (live parser, fixture, action, tool); nothing beyond the data is claimed. */
import { beforeEach, describe, expect, it } from "vitest";
import { buildTools } from "@/lib/agent/tools";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { parseDemographics } from "@/lib/qloo/live";
import { getStore, resetStore } from "@/lib/store";
import { audienceProfile, setAct } from "@/lib/tour/actions";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes", kind: "artist" as const };

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

describe("urn:demographics", () => {
  it("parses the live shape (results.demographics[0].query.{age,gender}, -1..1) and drops non-numbers", () => {
    const body = { success: true, results: { demographics: [{ entity_id: "X", query: { age: { "24_and_younger": 0, "25_to_29": -0.05, "35_to_44": 0.29, bogus: "n/a" }, gender: { male: 0.16, female: -0.16 } } }] } };
    const d = parseDemographics(body);
    expect(d.age).toEqual({ "24_and_younger": 0, "25_to_29": -0.05, "35_to_44": 0.29 });
    expect(d.gender).toEqual({ male: 0.16, female: -0.16 });
    expect(parseDemographics({ results: {} })).toEqual({ age: {}, gender: {}, raw: { results: {} } });
  });

  it("the fixture returns the same shape with values inside -1..1, deterministic per act", async () => {
    const a = await fx.demographics([act.entity_id]);
    const b = await fx.demographics([act.entity_id]);
    expect(a).toEqual(b);
    expect(Object.keys(a.age)).toHaveLength(6);
    expect(Object.values(a.age).every((v) => v >= -1 && v <= 1)).toBe(true);
    expect(a.gender.male).toBeCloseTo(-a.gender.female, 6);
    const other = await fx.demographics(["fx:artist:lowtide"]);
    expect(other.age).not.toEqual(a.age);
  });

  it("audienceProfile stores labelled buckets in age order and a one-sentence summary; absent adapter method -> undefined", async () => {
    const plan = getStore().plan;
    setAct(plan, act);
    const au = (await audienceProfile(act, plan, fx, new Date("2026-10-13T00:00:00Z")))!;
    expect(au.age.map((b) => b.label)).toEqual(["24 and younger", "25-29", "30-34", "35-44", "45-54", "55 and older"]);
    expect(au.gender.map((b) => b.label).sort()).toEqual(["female", "male"]);
    expect(au.summary).toMatch(/^Nova Reyes's audience /);
    expect(au.summary).toContain("on Qloo's demographics");
    expect(au.mode).toBe("fixture");
    expect(plan.audience).toBe(au);
    const bare = { mode: "fixture" as const, search: fx.search.bind(fx), insights: fx.insights.bind(fx), heatmap: fx.heatmap.bind(fx) };
    expect(await audienceProfile(act, plan, bare)).toBeUndefined();
    // Switching acts clears it.
    setAct(plan, { entity_id: "fx:artist:lowtide", name: "Lowtide" });
    expect(plan.audience).toBeUndefined();
  });

  it("rank_cities_by_affinity makes the one demographics call and a failure there never fails the ranking", async () => {
    const run = async (name: string, input: unknown) => (await buildTools()[name].execute!(input as never, { toolCallId: "t1", messages: [], context: undefined })) as Record<string, unknown>;
    const store = getStore();
    await run("resolve_artist", { query: "Nova Reyes" });
    const r = await run("rank_cities_by_affinity", { limit: 4 });
    expect(r.error).toBeUndefined();
    expect(String(r.audience)).toContain("Nova Reyes's audience");
    expect(store.plan.audience?.age).toHaveLength(6);
    expect(store.plan.calls.some((c) => c.params["filter.type"] === "urn:demographics")).toBe(true);
    // Second ranking reuses the stored profile (no second call).
    const n = store.plan.calls.filter((c) => c.params["filter.type"] === "urn:demographics").length;
    await run("rank_cities_by_affinity", { limit: 4 });
    expect(store.plan.calls.filter((c) => c.params["filter.type"] === "urn:demographics").length).toBe(n);
  });
});
