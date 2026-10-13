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
import type { Act, CompareResult, Itinerary, Plan, RankedCity, Stop } from "./types";
import { BASELINE_LABEL } from "./compare-text";

export type BaselineMode = "population" | "popularity";

/**
 * The `n` non-excluded candidates a promoter would pick with no taste data: by metro size, or by raw listener
 * density. A start city the promoter named is kept in both routes, so the diff only shows what taste changed.
 */
export function baselineCities(candidates: RankedCity[], n: number, mode: BaselineMode, keep?: string): string[] {
  const pool = candidates.filter((c) => !c.excluded);
  const metro = new Map(CITIES.map((c) => [c.name, c.metroM]));
  const sorted = [...pool].sort((a, b) => (mode === "population" ? (metro.get(b.city) ?? 0) - (metro.get(a.city) ?? 0) : b.popularity - a.popularity) || a.city.localeCompare(b.city));
  const kept = keep && pool.some((c) => c.city === keep) ? [keep] : [];
  return [...kept, ...sorted.map((c) => c.city).filter((c) => !kept.includes(c))].slice(0, n);
}

const round = (n: number, d = 3) => Number(n.toFixed(d));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const names = (stops: Stop[], pick: (s: Stop) => string | undefined) => [...new Set(stops.map(pick).filter((x): x is string => !!x))];
const diff = (a: string[], b: string[]) => a.filter((x) => !b.includes(x));

/** Stop-by-stop diff of the taste plan against a baseline itinerary. */
export function comparePlans(plan: Itinerary, baseline: Itinerary, against: CompareResult["against"], now = new Date()): CompareResult {
  const inPlan = new Set(plan.stops.map((s) => s.city));
  const inBase = new Set(baseline.stops.map((s) => s.city));
  const planAff = avg(plan.stops.map((s) => s.score));
  const baseAff = avg(baseline.stops.map((s) => s.score));
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
    const startCity = opts.startCity ?? current.startCity;
    const cities = baselineCities(plan.candidates, current.stops.length, against, startCity);
    if (cities.length === 0) throw new Error("No candidates to build a baseline from; rank cities first.");
    // Same start city, same dates, same gap, same routing (nearest neighbour + 2-opt from that start).
    baseline = makeItinerary(act, plan, policy, { cities, startCity, startDate: opts.startDate ?? current.startDate, gapDays: opts.gapDays ?? current.gapDays }, plan.mode, now);
    baseline.id = `baseline_${against}_${current.id}`;
  }
  const result = comparePlans(current, baseline, against, now);
  plan.compare = result;
  return result;
}

export { compareText } from "./compare-text";
