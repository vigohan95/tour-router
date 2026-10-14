/** Share page v2: the whole policy snapshot and the audit log travel in the link, under a URL budget; v1 links still open. */
import { beforeEach, describe, expect, it } from "vitest";
import { parsePolicy } from "@/lib/policy/schema";
import { FixtureQloo } from "@/lib/qloo/fixture";
import { audit, getStore, resetStore, runWithStore } from "@/lib/store";
import { buildItinerary, pickPartners, rankCities, setAct } from "@/lib/tour/actions";
import { compareWith } from "@/lib/tour/compare";
import { MAX_SHARE_PATH, SHARE_AUDIT_LINES, SHARE_VERSION, buildSharePayload, decodeShare, encodeShare, sharePath } from "@/lib/tour/share";

const fx = new FixtureQloo();
const act = { entity_id: "fx:artist:nova-reyes", name: "Nova Reyes", kind: "artist" as const };

beforeEach(() => {
  resetStore(new Date("2026-10-10T12:00:00Z"));
});

async function session(policy = parsePolicy({})) {
  const store = getStore();
  store.policy = policy;
  await runWithStore(store, async () => {
    setAct(store.plan, act);
    store.plan.candidates = await rankCities(act, store.policy, {}, fx);
    const cities = store.plan.candidates.filter((c) => !c.noSignal).slice(0, 3).map((c) => c.city);
    for (const c of cities) await pickPartners(act, c, store.policy, store.plan, fx);
    buildItinerary(act, store.plan, store.policy, { cities, startDate: "2027-03-01" });
    compareWith(act, store.plan, store.policy, "population");
    audit({ actor: "policy", tool: "build_itinerary", action: "Build a 9-stop itinerary - waiting for your approval", decision: "approval-required", reason: "9 stops is over your 6-city cap.", rule: "maxCities" });
    audit({ actor: "policy", tool: "pick_city_partners", action: "Find partners in Phoenix - blocked", decision: "denied", reason: "Phoenix is on your exclude list.", rule: "excludeCities" });
    audit({ actor: "agent", tool: "build_itinerary", action: "Build a 3-stop itinerary", decision: "allowed", reason: "inside the cap", rule: "maxCities" });
  });
  return store;
}

describe("share payload v2", () => {
  it("carries the full policy and the newest audit entries with decision, rule and reason", async () => {
    const store = await session(parsePolicy({ excludeCities: ["Phoenix"], blackoutDates: ["2027-03-05"], heldVenues: [{ city: "Denver", venue: "Mission Ballroom", date: "2027-03-09" }], minKmBetweenStops: 200, maxKmPerLeg: 2500 }));
    const p = buildSharePayload(store.plan, store.policy, store.audit, new Date("2026-10-13T00:00:00Z"));
    expect(p.v).toBe(SHARE_VERSION);
    expect(p.policy).toMatchObject({ excludeCities: ["Phoenix"], blackoutDates: ["2027-03-05"], heldVenues: [{ city: "Denver", venue: "Mission Ballroom", date: "2027-03-09" }], minKmBetweenStops: 200, maxKmPerLeg: 2500, approvals: { itinerary: "auto" } });
    expect(p.audit.entries!.length).toBe(3);
    expect(p.audit.entries!.length).toBeLessThanOrEqual(SHARE_AUDIT_LINES);
    expect(p.audit.entries![0]).toMatchObject({ decision: "allowed", action: "Build a 3-stop itinerary", rule: "maxCities", reason: "inside the cap" });
    expect(p.audit.entries![1]).toMatchObject({ decision: "denied", rule: "excludeCities", reason: "Phoenix is on your exclude list." });
    expect(p.audit.entries![2]).toMatchObject({ decision: "approval-required", rule: "maxCities" });
    expect(p.audit.entries!.every((e) => /^\d{2}:\d{2}$/.test(e.t))).toBe(true);
    expect(p.audit.entries!.some((e) => e.decision === "info")).toBe(false);
    expect(p.audit.total).toBe(store.audit.length);
    expect(p.audit.note).toBeUndefined();
    expect(p.audit.denied).toBe(1);
    expect(p.audit.approvalRequired).toBe(1);
    // Still no ids, still round-trips, still within the budget.
    const json = JSON.stringify(p);
    expect(json).not.toContain("entity_id");
    expect(json).not.toContain("fx:artist");
    const path = sharePath(p);
    expect(path.length).toBeLessThanOrEqual(MAX_SHARE_PATH);
    expect(decodeShare(path.slice(3))).toEqual(p);
  });

  it("trims the audit log (then the candidate table) to stay under the URL budget and says so", async () => {
    const store = await session();
    for (let i = 0; i < 250; i++) audit({ actor: "agent", tool: "pick_city_partners", action: `Find partners in City ${i} with a deliberately long action label to inflate the payload size`, decision: "allowed", reason: "Looks up venues, brands and openers; commits to nothing, and this reason is padded to make the entry heavier than usual.", rule: "read-only" });
    const p = buildSharePayload(store.plan, store.policy, store.audit);
    expect(sharePath(p).length).toBeLessThanOrEqual(MAX_SHARE_PATH);
    expect(p.audit.entries!.length).toBeLessThan(250);
    expect(p.audit.note).toMatch(/Showing the newest \d+ of \d+ decisions/);
    expect(p.audit.total).toBe(store.audit.length);
    expect(p.candidates.length).toBeGreaterThan(0);
    expect(decodeShare(sharePath(p).slice(3))).toEqual(p);
  });

  it("still opens v1 links and rejects unknown versions", async () => {
    const store = await session();
    const p = buildSharePayload(store.plan, store.policy, store.audit);
    const v1 = { ...p, v: 1, audit: { allowed: 1, approved: 0, denied: 0, approvalRequired: 0, errors: 0, lines: ["allowed: Build a 3-stop itinerary [maxCities]"] } };
    expect(decodeShare(encodeShare(v1))).toEqual(v1);
    expect(decodeShare(encodeShare({ ...p, v: 3 }))).toBeUndefined();
  });
});
