/**
 * "Why not X?": the negative explanation for a city that is NOT in the itinerary, pure. Three sources, in order:
 * (a) the heatmap rank and taste lift, (b) the population counterfactual (would the obvious route have played it?),
 * (c) the policy (excluded, inside the radius clause of a routed stop, cut by the city cap). Nothing is guessed:
 * every line quotes a number or a policy field that is already on the plan.
 */
import { isExcluded, type Policy } from "../policy/schema";
import { COUNTRY_QUERY } from "./cities";
import { baselineCities } from "./compare";
import { radiusConflict } from "./legs";
import type { Plan, RankedCity } from "./types";

export interface WhyNot {
  city: string;
  routed: boolean;
  /** Short tags for the UI: "excluded", "radius", "cap", "unscored", "population-only", "not-ranked". */
  reasons: string[];
  lines: string[];
  rule?: string;
}

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

export function whyNot(plan: Plan, policy: Policy, cityName: string): WhyNot {
  const ranked: RankedCity | undefined = plan.candidates.find((c) => c.city.toLowerCase() === cityName.toLowerCase());
  const city = ranked?.city ?? cityName;
  const it = plan.itinerary;
  const routed = !!it?.stops.some((s) => s.city === city);
  const lines: string[] = [];
  const reasons: string[] = [];
  let rule: string | undefined;
  if (routed) return { city, routed, reasons, lines: [`${city} is in the route (stop ${it!.stops.find((s) => s.city === city)!.order}).`] };
  if (!ranked) {
    reasons.push("not-ranked");
    lines.push(`${city} was not among the ranked candidates (outside the regions asked for, below the ranking limit, or not in the catalogue), so it was never scored.`);
    if (isExcluded(policy, city)) {
      reasons.push("excluded");
      rule = "excludeCities";
      lines.push(`It is also on the policy's exclude list (excludeCities), so it would be refused anyway.`);
    }
    return { city, routed, reasons, lines, rule };
  }
  // (a) heatmap rank and lift
  if (ranked.noSignal) {
    reasons.push("unscored");
    lines.push(`${city} is unscored: ${ranked.note ?? "Qloo has no heatmap cell for the act within 60 km"}, and an unscored city is never routed on a guess.`);
  } else {
    const liftTxt = ranked.lift > 0 ? `lift +${ranked.lift}: taste says more than its size` : ranked.lift < 0 ? `lift ${ranked.lift}: a bigger metro than its taste rank` : "lift 0";
    lines.push(`${city} ranks #${ranked.rank} of ${plan.candidates.length} by fan affinity (${pct1(ranked.score)} on Qloo's ${COUNTRY_QUERY[ranked.country] ?? ranked.country} heatmap; #${ranked.populationRank} by metro size, ${liftTxt}).`);
    if (ranked.jointScore !== undefined && ranked.jointRank !== undefined && plan.coBill) lines.push(`With ${plan.coBill.opener.name} on the bill it would rank #${ranked.jointRank} (${pct1(ranked.jointScore)}).`);
  }
  // (c) policy: excluded
  if (isExcluded(policy, city)) {
    reasons.push("excluded");
    rule = "excludeCities";
    lines.push(`It is on the policy's exclude list (excludeCities), so partners and routing are refused for it.`);
  } else if (ranked.excluded) {
    reasons.push("excluded");
    rule = "grid.excluded";
    lines.push(`It was excluded in the grid${ranked.excludedReason ? ` (${ranked.excludedReason})` : ""}, so it is never routed.`);
  }
  // (c) policy: radius clause against a routed stop
  if (it) {
    const conflict = radiusConflict(city, it.stops.map((s) => s.city), policy.minKmBetweenStops);
    if (conflict) {
      reasons.push("radius");
      rule ??= "minKmBetweenStops";
      lines.push(`It is ${conflict.km} km from ${conflict.b}, inside the ${policy.minKmBetweenStops} km radius clause (minKmBetweenStops); routing both would be refused.`);
    }
  }
  // (c) policy: cut by the cap / stop count
  if (it && !ranked.noSignal && !reasons.includes("excluded") && !reasons.includes("radius")) {
    const n = it.stops.length;
    const worstRouted = Math.max(...it.stops.map((s) => plan.candidates.find((c) => c.city === s.city)?.rank ?? 0));
    if (ranked.rank > worstRouted) {
      reasons.push("cap");
      rule ??= "maxCities";
      lines.push(`The route has ${n} stops${n >= policy.maxCities ? ` (the policy's cap is ${policy.maxCities}, maxCities)` : ""} and the lowest-ranked stop in it is #${worstRouted}; #${ranked.rank} did not make the cut. Raise the cap or skip a stop to bring it in.`);
    } else {
      lines.push(`It outranks a routed stop, so it was left out by the brief, not by the score: a named start city, a skip, or the radius filter took its place.`);
    }
  }
  // (b) population counterfactual membership
  if (it) {
    const obvious = baselineCities(plan.candidates, it.stops.length, "population", it.startCity, policy.minKmBetweenStops);
    if (obvious.includes(city)) {
      reasons.push("population-only");
      lines.push(`The obvious route (biggest metros, what a model with no taste data picks) WOULD play ${city}; taste dropped it.`);
    } else {
      lines.push(`The obvious route (biggest metros, no taste data) would not play it either.`);
    }
    if (plan.compare?.swappedOut.some((s) => s.city === city)) lines.push(`It is one of the cities the last comparison (${plan.compare.label}) listed as "would pick instead".`);
  }
  return { city, routed, reasons, lines, rule };
}
