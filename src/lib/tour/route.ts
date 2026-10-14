/**
 * Routing: pure functions, no I/O. Nearest-neighbour from the chosen start, then 2-opt until no improvement.
 * Good enough for 5-30 stops; exact TSP is pointless for a tour that humans will re-order by hand anyway.
 */

export interface Point {
  lat: number;
  lon: number;
}

const R = 6371; // km

export function haversineKm(a: Point, b: Point): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function pathKm(points: Point[]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
  return km;
}

/** Order indices by nearest neighbour starting at `start`. */
export function nearestNeighbour(points: Point[], start = 0): number[] {
  if (points.length === 0) return [];
  const left = new Set(points.map((_, i) => i));
  const order = [start];
  left.delete(start);
  while (left.size) {
    const last = points[order[order.length - 1]];
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const d = haversineKm(last, points[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
  }
  return order;
}

/** 2-opt on an open path (the tour does not return to the start). Keeps the first stop fixed. */
export function twoOpt(points: Point[], order: number[], maxPasses = 50): number[] {
  const n = order.length;
  if (n < 4) return [...order];
  const cur = [...order];
  const d = (i: number, k: number) => haversineKm(points[cur[i]], points[cur[k]]);
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        // Reverse cur[i..k]. Edges affected: (i-1,i) and (k,k+1) (the latter only if k < n-1).
        const before = d(i - 1, i) + (k < n - 1 ? d(k, k + 1) : 0);
        const after = d(i - 1, k) + (k < n - 1 ? d(i, k + 1) : 0);
        if (after + 1e-9 < before) {
          cur.splice(i, k - i + 1, ...cur.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return cur;
}

/** Best open path over the points: nearest neighbour from the given start (or the best of all starts) + 2-opt. */
export function routeOrder(points: Point[], start?: number): number[] {
  if (points.length <= 1) return points.map((_, i) => i);
  const starts = start !== undefined ? [start] : points.map((_, i) => i);
  let best: number[] = [];
  let bestKm = Infinity;
  for (const s of starts) {
    const o = twoOpt(points, nearestNeighbour(points, s));
    const km = pathKm(o.map((i) => points[i]));
    if (km < bestKm) {
      bestKm = km;
      best = o;
    }
  }
  return best;
}

export interface DateOptions {
  /** yyyy-mm-dd dates that are never show dates (policy.blackoutDates). */
  blackout?: string[];
  /** Dates already taken by held stops: free dates keep at least `gapDays` away from them. */
  avoid?: string[];
}

export const DAY_MS = 86_400_000;

export function addDays(iso: string, n: number): string {
  return new Date(new Date(iso + "T00:00:00Z").getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / DAY_MS);
}

/**
 * Spread `n` show dates from `start`, at least `gapDays` apart, never on a blackout date and never within `gapDays`
 * of a held date. A date that collides moves forward one day at a time (bounded, so a policy full of blackouts
 * cannot loop forever).
 */
export function showDates(start: Date, n: number, gapDays = 2, opts: DateOptions = {}): string[] {
  const blackout = new Set(opts.blackout ?? []);
  const avoid = opts.avoid ?? [];
  const clashes = (d: string) => blackout.has(d) || avoid.some((a) => Math.abs(daysBetween(a, d)) < gapDays);
  const out: string[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())).toISOString().slice(0, 10);
  for (let i = 0; i < n; i++) {
    let d = i === 0 ? cursor : addDays(cursor, gapDays);
    for (let guard = 0; guard < 400 && clashes(d); guard++) d = addDays(d, 1);
    out.push(d);
    cursor = d;
  }
  return out;
}
