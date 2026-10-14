/**
 * Counterfactuals, pure: "what would this tour look like without Qloo?" and "what did the last rebuild change?".
 *
 * baselineCities picks the same number of stops by metro population (no Qloo at all) or by Qloo heatmap
 * popularity (listener density, not affinity); comparePlans diffs two itineraries stop by stop. Every number in
 * the diff comes from the plan's own stops (Qloo scores, routed km, partner names); nothing is estimated here.
 */
import type { Policy } from "../policy/schema";
import { CITIES } from "./cities";
import { makeItinerary, type BuildOptions } from "./actions";
import { respectRadius } from "./legs";
import type { Act, CompareResult, Itinerary, Plan, RankedCity, Stop } from "./types";
import { BASELINE_LABEL } from "./compare-text";

export type BaselineMode = "population" | "popularity" | "cobill";

/**
 * The `n` non-excluded candidates a promoter would pick with no taste data: by metro size, or by raw listener
 * density. A start city the promoter named is kept in both routes, so the diff only shows what taste changed.
 */
export function baselineCities(candidates: RankedCity[], n: number, mode: BaselineMode, keep?: string, minKm = 0): string[] {
  // Co-bill: only cities with a joint score can be ranked on it (unscored cities are never routed on a guess).
  const pool = candidates.filter((c) => !c.excluded && (mode !== "cobill" || c.jointScore !== undefined));
  const metro = new Map(CITIES.map((c) => [c.name, c.metroM]));
  const value = (c: RankedCity) => (mode === "population" ? (metro.get(c.city) ?? 0) : mode === "popularity" ? c.popularity : (c.jointScore ?? 0));
  const sorted = [...pool].sort((a, b) => value(b) - value(a) || a.city.localeCompare(b.city));
  const kept = keep && pool.some((c) => c.city === keep) ? [keep] : [];
  const ordered = [...kept, ...sorted.map((c) => c.city).filter((c) => !kept.includes(c))];
  // The baseline obeys the same radius clause as the taste route: same rules, different data.
  return (minKm > 0 ? respectRadius(ordered, minKm) : ordered).slice(0, n);
}

const round = (n: number, d = 3) => Number(n.toFixed(d));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const names = (stops: Stop[], pick: (s: Stop) => string | undefined) => [...new Set(stops.map(pick).filter((x): x is string => !!x))];
const diff = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));

/** Stop-by-stop diff of the taste plan against a baseline itinerary. `joint` = per-city co-bill affinity when a tour opener is picked. */
export function comparePlans(plan: Itinerary, baseline: Itinerary, against: CompareResult["against"], now = new Date(), joint?: Map<string, number>): CompareResult {
  const inPlan = new Set(plan.stops.map((s) => s.city));
  const inBase = new Set(baseline.stops.map((s) => s.city));
  const planAff = avg(plan.stops.map((s) => s.score));
  const baseAff = avg(baseline.stops.map((s) => s.score));
  const jointOf = (stops: Stop[]) => stops.map((s) => joint?.get(s.city)).filter((x): x is number => x !== undefined);
  const jp = joint ? jointOf(plan.stops) : [];
  const jb = joint ? jointOf(baseline.stops) : [];
  const avgJointAffinity = joint && jp.length && jb.length ? { plan: round(avg(jp)), baseline: round(avg(jb)), delta: round(avg(jp) - avg(jb)) } : undefined;
  const openersPlan = names(plan.stops, (s) => s.opener?.name);
  const openersBase = names(baseline.stops, (s) => s.opener?.name);
  const brandsPlan = names(plan.stops, (s) => s.brand?.name);
  const brandsBase = names(baseline.stops, (s) => s.brand?.name);
  return {
    against,
    label: BASELINE_LABEL[against],
    swappedIn: plan.stops.filter((s) => !inBase.has(s.city)),
    swappedOut: baseline.stops.filter((s) => !inPlan.has(s.city)),
    avgAffinity: { plan: round(planAff), baseline: round(baseAff), delta: round(planAff - baseAff) },
    avgJointAffinity,
    totalKm: { plan: plan.totalKm, baseline: baseline.totalKm, delta: plan.totalKm - baseline.totalKm },
    estimatedCostUsd: { plan: plan.estimatedCostUsd, baseline: baseline.estimatedCostUsd, delta: plan.estimatedCostUsd - baseline.estimatedCostUsd },
    openers: { gained: diff(openersPlan, openersBase), lost: diff(openersBase, openersPlan) },
    brands: { gained: diff(brandsPlan, brandsBase), lost: diff(brandsBase, brandsPlan) },
    baseline,
    computedAt: now.toISOString(),
  };
}

/**
 * Compare the plan's itinerary with a baseline built from the same candidates, same stop count, same start
 * and dates, routed the same way; or with the itinerary the last rebuild replaced. Stores the result on the plan.
 * Baseline stops only carry partners for cities whose partners were already fetched (nothing is invented).
 */
export function compareWith(act: Act, plan: Plan, policy: Policy, against: CompareResult["against"], opts: Partial<BuildOptions> = {}, now = new Date()): CompareResult {
  const current = plan.itinerary;
  if (!current) throw new Error("No itinerary to compare yet; build one first.");
  let baseline: Itinerary;
  if (against === "previous") {
    if (!plan.previousItinerary) throw new Error("There is no previous itinerary to compare with.");
    baseline = plan.previousItinerary;
  } else {
    if (against === "cobill" && !plan.coBill) throw new Error("Pick a tour opener first (pick_tour_opener); the co-bill route ranks cities on the headliner + opener joint heatmap.");
    const startCity = opts.startCity ?? current.startCity;
    const cities = baselineCities(plan.candidates, current.stops.length, against, startCity, policy.minKmBetweenStops);
    if (cities.length === 0) throw new Error("No candidates to build a baseline from; rank cities first.");
    // Same start city, same dates, same gap, same routing (nearest neighbour + 2-opt from that start).
    baseline = makeItinerary(act, plan, policy, { cities, startCity, startDate: opts.startDate ?? current.startDate, gapDays: opts.gapDays ?? current.gapDays }, plan.mode, now);
    baseline.id = `baseline_${against}_${current.id}`;
  }
  const joint = plan.coBill ? new Map(plan.candidates.filter((c) => c.jointScore !== undefined).map((c) => [c.city, c.jointScore!])) : undefined;
  const result = comparePlans(current, baseline, against, now, joint);
  plan.compare = result;
  return result;
}

export { compareText } from "./compare-text";
