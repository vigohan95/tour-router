/**
 * Radius clause and leg-length checks, pure. The policy engine calls these before build_itinerary runs, on the
 * same order makeItinerary would produce (nearest neighbour + 2-opt from the named start, or the given order).
 */
import { CITIES, findCity, type City } from "./cities";
import { haversineKm, routeOrder } from "./route";

export interface LegViolation {
  a: string;
  b: string;
  km: number;
}

export interface LegChecks {
  /** Pairs of stops closer than the radius clause (any two stops, not only consecutive ones). */
  tooClose: LegViolation[];
  /** Consecutive legs longer than the per-leg cap, in route order. */
  tooFar: LegViolation[];
}

export function cityPoints(names: string[]): City[] {
  return names.map((n) => findCity(n)).filter((c): c is City => !!c);
}

/** Pairs closer than `minKm` among the given cities. */
export function pairsCloserThan(cities: City[], minKm: number): LegViolation[] {
  const out: LegViolation[] = [];
  if (minKm <= 0) return out;
  for (let i = 0; i < cities.length; i++) {
    for (let j = i + 1; j < cities.length; j++) {
      const km = Math.round(haversineKm(cities[i], cities[j]));
      if (km < minKm) out.push({ a: cities[i].name, b: cities[j].name, km });
    }
  }
  return out;
}

/** The order makeItinerary would route these cities in (indices into `cities`). */
export function plannedOrder(cities: City[], opts: { startCity?: string; keepOrder?: boolean } = {}): number[] {
  if (opts.keepOrder) return cities.map((_, i) => i);
  const startIdx = opts.startCity ? cities.findIndex((c) => c.name.toLowerCase() === opts.startCity!.toLowerCase()) : -1;
  return routeOrder(cities, startIdx >= 0 ? startIdx : undefined);
}

export function legsLongerThan(cities: City[], maxKm: number | undefined, opts: { startCity?: string; keepOrder?: boolean } = {}): LegViolation[] {
  if (!maxKm) return [];
  const order = plannedOrder(cities, opts);
  const out: LegViolation[] = [];
  for (let i = 1; i < order.length; i++) {
    const a = cities[order[i - 1]];
    const b = cities[order[i]];
    const km = Math.round(haversineKm(a, b));
    if (km > maxKm) out.push({ a: a.name, b: b.name, km });
  }
  return out;
}

export function legChecks(cityNames: string[], policy: { minKmBetweenStops: number; maxKmPerLeg?: number }, opts: { startCity?: string; keepOrder?: boolean } = {}): LegChecks {
  const cities = cityPoints(cityNames);
  return { tooClose: pairsCloserThan(cities, policy.minKmBetweenStops), tooFar: legsLongerThan(cities, policy.maxKmPerLeg, opts) };
}

/**
 * Greedy radius filter: walk `names` in order and keep a city only when it is at least `minKm` from every city
 * already kept (and from `anchors`, e.g. held stops). The rule planner and the baselines use it so every route
 * they propose respects the promoter's radius clause before the policy engine sees it.
 */
export function respectRadius(names: string[], minKm: number, anchors: string[] = []): string[] {
  if (minKm <= 0) return [...names];
  const kept: City[] = cityPoints(anchors);
  const out: string[] = [];
  for (const name of names) {
    const c = findCity(name);
    if (!c) continue;
    if (kept.every((k) => haversineKm(k, c) >= minKm)) {
      kept.push(c);
      out.push(c.name);
    }
  }
  return out;
}

/** Nearest routed city to `name` that sits inside the radius clause (for "why not X?"). */
export function radiusConflict(name: string, routed: string[], minKm: number): LegViolation | undefined {
  const c = findCity(name);
  if (!c || minKm <= 0) return undefined;
  let best: LegViolation | undefined;
  for (const r of routed) {
    const other = CITIES.find((x) => x.name === r);
    if (!other || other.name === c.name) continue;
    const km = Math.round(haversineKm(c, other));
    if (km < minKm && (!best || km < best.km)) best = { a: c.name, b: other.name, km };
  }
  return best;
}
