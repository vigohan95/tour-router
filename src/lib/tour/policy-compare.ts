/**
 * Policy counterfactual, pure: the same brief under two policies. Every other counterfactual in this product (and
 * in the field) varies the DATA (taste vs population); this one varies the RULES. Policy B is policy A with one
 * field changed; the route under B is rebuilt from the cached ranking with no Qloo call, and every decision the
 * agent would face is evaluated under both policies so the audit can say "allowed under A, denied under B".
 */
import { evaluateAction, type Decision } from "../policy/engine";
import { isExcluded, type Policy } from "../policy/schema";
import { makeItinerary } from "./actions";
import { respectRadius } from "./legs";
import type { Act, Itinerary, Plan } from "./types";

import { FIELD_LABEL, POLICY_FIELDS, type PolicyChange, type PolicyField } from "./policy-fields";

export { FIELD_LABEL, POLICY_FIELDS, type PolicyChange, type PolicyField };

export interface PolicyDecisionDiff {
  action: string;
  underA: Decision;
  underB: Decision;
  ruleA: string;
  ruleB: string;
  reasonB: string;
}

export interface PolicyDiff {
  field: PolicyField;
  from: string;
  to: string;
  /** "city cap 6 -> 8" */
  label: string;
  /** Decisions that differ between the two policies (plus build_itinerary for both routes, always). */
  decisions: PolicyDecisionDiff[];
  stopsA: number;
  stopsB: number;
}

const list = (v: PolicyChange["value"]): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);
const numberOf = (v: PolicyChange["value"], field: string): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`${field} needs a number.`);
  return n;
};

/** Clone policy A and apply the one change. List fields ADD to the existing list. */
export function applyChange(policy: Policy, change: PolicyChange): Policy {
  const b = structuredClone(policy);
  switch (change.field) {
    case "maxCities":
      b.maxCities = Math.max(1, Math.round(numberOf(change.value, "maxCities")));
      break;
    case "minKmBetweenStops":
      b.minKmBetweenStops = Math.max(0, numberOf(change.value, "minKmBetweenStops"));
      break;
    case "minGapDays":
      b.minGapDays = Math.min(14, Math.max(1, Math.round(numberOf(change.value, "minGapDays"))));
      break;
    case "maxKmPerLeg":
      b.maxKmPerLeg = change.value === null || change.value === "" ? undefined : Math.max(1, numberOf(change.value, "maxKmPerLeg"));
      break;
    case "excludeCities":
      b.excludeCities = [...new Set([...b.excludeCities, ...list(change.value)])];
      break;
    case "blackoutDates": {
      const dates = list(change.value);
      const bad = dates.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
      if (bad) throw new Error(`Blackout date "${bad}" must be yyyy-mm-dd.`);
      b.blackoutDates = [...new Set([...b.blackoutDates, ...dates])];
      break;
    }
  }
  return b;
}

export function describeValue(policy: Policy, field: PolicyField): string {
  switch (field) {
    case "maxCities":
      return `${policy.maxCities} cities`;
    case "minKmBetweenStops":
      return `${policy.minKmBetweenStops} km`;
    case "minGapDays":
      return `${policy.minGapDays} days`;
    case "maxKmPerLeg":
      return policy.maxKmPerLeg ? `${policy.maxKmPerLeg.toLocaleString("en-US")} km` : "no cap";
    case "excludeCities":
      return policy.excludeCities.join(", ") || "none";
    case "blackoutDates":
      return policy.blackoutDates.join(", ") || "none";
  }
}

/**
 * The cities the agent would route under policy B from the cached ranking: taste order, minus cities excluded under
 * B (policy or grid), the start city kept, the radius clause applied greedily; B's cap when the cap is what changed,
 * otherwise the current stop count.
 */
export function citiesUnderPolicy(plan: Plan, policyB: Policy, current: Itinerary, field: PolicyField): string[] {
  const n = field === "maxCities" ? policyB.maxCities : current.stops.length;
  const pool = plan.candidates.filter((c) => !c.noSignal && !(c.excluded && c.excludedReason !== "policy.excludeCities") && !isExcluded(policyB, c.city)).map((c) => c.city);
  const start = current.startCity && pool.includes(current.startCity) ? current.startCity : undefined;
  const ordered = start ? [start, ...pool.filter((c) => c !== start)] : pool;
  const anchors = policyB.heldVenues.map((h) => h.city).filter((h) => !ordered.includes(h));
  return respectRadius(ordered, policyB.minKmBetweenStops, anchors).slice(0, n);
}

/** Rebuild the itinerary under policy B (no Qloo call; partners only for cities already fetched). */
export function routeUnderPolicy(act: Act, plan: Plan, policyB: Policy, current: Itinerary, field: PolicyField, now = new Date()): Itinerary {
  const cities = citiesUnderPolicy(plan, policyB, current, field);
  if (cities.length === 0) throw new Error("Under policy B no candidate city is left to route.");
  const it = makeItinerary(act, plan, policyB, { cities, startCity: current.startCity, startDate: current.startDate, gapDays: current.gapDays }, plan.mode, now);
  it.id = `policyB_${current.id}`;
  return it;
}

/** Every decision the agent would face on either route, under A and under B; only the ones that differ are kept (build_itinerary always). */
export function decisionDiff(plan: Plan, policyA: Policy, policyB: Policy, routeA: Itinerary, routeB: Itinerary): PolicyDecisionDiff[] {
  const out: PolicyDecisionDiff[] = [];
  const ctxA = { policy: policyA, plan };
  const ctxB = { policy: policyB, plan };
  const push = (tool: string, input: Record<string, unknown>, always = false) => {
    const a = evaluateAction(tool, input, ctxA);
    const b = evaluateAction(tool, input, ctxB);
    if (always || a.decision !== b.decision || a.rule !== b.rule) out.push({ action: a.summary, underA: a.decision, underB: b.decision, ruleA: a.rule, ruleB: b.rule, reasonB: b.reason });
  };
  const citiesA = routeA.stops.map((s) => s.city);
  const citiesB = routeB.stops.map((s) => s.city);
  push("build_itinerary", { cities: citiesA, startCity: routeA.startCity }, true);
  if (citiesB.join("|") !== citiesA.join("|")) push("build_itinerary", { cities: citiesB, startCity: routeB.startCity }, true);
  for (const city of [...new Set([...citiesA, ...citiesB])]) push("pick_city_partners", { city });
  return out;
}

export function policyDiffText(d: Pick<PolicyDiff, "label" | "decisions">): string {
  const word = (x: Decision) => (x === "allow" ? "allowed" : x === "approve" ? "needs approval" : "denied");
  const lines = d.decisions.map((x) => `${x.action}: ${word(x.underA)} under A, ${word(x.underB)} under B${x.underB !== "allow" ? ` [${x.ruleB}]` : ""}`);
  return `Policy B = policy A with ${d.label}. ${lines.join("; ")}.`;
}
