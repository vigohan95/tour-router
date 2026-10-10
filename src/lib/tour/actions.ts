/**
 * The five things the agent can do, as plain async functions over the Qloo adapter and the store.
 * The AI SDK tools in ../agent/tools.ts wrap these; the UI can also call them directly (same code path).
 */
import { getQloo } from "../qloo";
import type { Contribution, QlooAdapter } from "../qloo/types";
import type { Policy } from "../policy/schema";
import { isExcluded } from "../policy/schema";
import { getStore, touch } from "../store";
import { citiesIn, findCity, type City, type Region } from "./cities";
import { pathKm, routeOrder, showDates } from "./route";
import { partnerFromEntity, type Act, type CityPartners, type Itinerary, type Partner, type Plan, type RankedCity, type Stop } from "./types";

const TOP_CELLS = 10;

export async function resolveArtist(query: string, qloo: QlooAdapter = getQloo()): Promise<{ query: string; hits: Act[]; mode: string }> {
  const hits = await qloo.search(query, ["urn:entity:artist"], 6);
  return { query, hits: hits.map((h) => ({ entity_id: h.entity_id, name: h.name, hint: h.hint, popularity: h.popularity })), mode: qloo.mode };
}

/** Pick an act and reset the plan around it. */
export function setAct(plan: Plan, act: Act) {
  if (plan.act?.entity_id !== act.entity_id) {
    plan.candidates = [];
    plan.partners = {};
    plan.itinerary = undefined;
  }
  plan.act = act;
  touch();
}

/** Mean of the strongest heatmap cells = how much this market's population cares about the act. */
export function aggregateHeatmap(cells: { affinity: number }[], top = TOP_CELLS): number {
  if (cells.length === 0) return 0;
  const sorted = [...cells].sort((a, b) => b.affinity - a.affinity).slice(0, top);
  return Number((sorted.reduce((a, c) => a + c.affinity, 0) / sorted.length).toFixed(3));
}

export interface RankOptions {
  regions?: Region[];
  limit?: number;
  /** Only these cities (names) are considered when given. */
  only?: string[];
}

export async function rankCities(act: Act, policy: Policy, opts: RankOptions = {}, qloo: QlooAdapter = getQloo()): Promise<RankedCity[]> {
  const regions = opts.regions?.length ? opts.regions : (policy.regions as Region[]);
  let pool: City[] = citiesIn(regions);
  if (opts.only?.length) {
    const wanted = opts.only.map((c) => findCity(c)).filter((c): c is City => !!c);
    if (wanted.length) pool = wanted;
  }
  const scored = await Promise.all(
    pool.map(async (city) => {
      const hm = await qloo.heatmap({ signalEntities: [act.entity_id], location: { query: city.name }, take: 50 });
      const topCells = [...hm.cells].sort((a, b) => b.affinity - a.affinity).slice(0, TOP_CELLS);
      return { city: city.name, country: city.country, region: city.region, lat: city.lat, lon: city.lon, score: aggregateHeatmap(hm.cells), cells: hm.cells.length, topCells, rank: 0 } satisfies RankedCity;
    }),
  );
  const ranked = scored
    .sort((a, b) => b.score - a.score || a.city.localeCompare(b.city))
    .map((c, i) => ({ ...c, rank: i + 1, excluded: isExcluded(policy, c.city) || undefined, excludedReason: isExcluded(policy, c.city) ? "policy.excludeCities" : undefined }));
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

function whyText(act: Act, city: string, venue: Partner | undefined, brands: Partner[], openers: Partner[], score: number | undefined): string {
  const pct = (n: number | undefined) => (n === undefined ? "n/a" : `${Math.round(n * 100)}%`);
  const top = (c?: Contribution[]) => c?.slice().sort((a, b) => b.score - a.score)[0];
  const parts: string[] = [];
  if (score !== undefined) parts.push(`${city} scores ${pct(score)} affinity for ${act.name} fans on Qloo's heatmap.`);
  if (venue) {
    const t = top(venue.explainability);
    parts.push(`${venue.name}${venue.capacity ? ` (${venue.capacity.toLocaleString("en-US")} cap)` : ""} is the venue whose crowd overlaps most with the act (${pct(venue.affinity)}${t ? `; ${pct(t.score)} of that comes from the ${t.label ?? "act"} signal` : ""}).`);
  }
  if (brands[0]) parts.push(`${brands[0].name} (${brands[0].detail}) is the brand their audience over-indexes on - a local co-promotion candidate.`);
  if (openers[0]) parts.push(`${openers[0].name} (${openers[0].detail}) is the opener with the highest cross-affinity among trending local acts.`);
  return parts.join(" ");
}

export async function pickPartners(act: Act, city: string, policy: Policy, plan: Plan, qloo: QlooAdapter = getQloo()): Promise<CityPartners> {
  const c = findCity(city);
  if (!c) throw new Error(`Unknown city "${city}". Use one of the ranked candidate cities.`);
  const signal = [act.entity_id];
  const [venues, brands, openers] = await Promise.all([
    qloo.insights({ type: "urn:entity:place", signalEntities: signal, location: { query: c.name }, tags: ["urn:tag:genre:place:music_venue"], take: 8, explainability: true }),
    qloo.insights({ type: "urn:entity:brand", signalEntities: signal, location: { query: c.name }, take: 5, explainability: true }),
    qloo.insights({ type: "urn:entity:artist", signalEntities: signal, location: { query: c.name }, take: 5, explainability: true, trends: "high", excludeEntities: [act.entity_id] }),
  ]);
  const v = venues.entities.map(partnerFromEntity);
  const inWindow = v.filter((x) => x.capacity === undefined || (x.capacity >= policy.venue.minCapacity && x.capacity <= policy.venue.maxCapacity));
  const recommendedVenue = inWindow[0] ?? v[0];
  const b = brands.entities.map(partnerFromEntity);
  const o = openers.entities.map(partnerFromEntity);
  const score = plan.candidates.find((x) => x.city === c.name)?.score;
  const result: CityPartners = { city: c.name, venues: v, brands: b, openers: o, recommendedVenue, why: whyText(act, c.name, recommendedVenue, b, o, score), mode: qloo.mode };
  plan.partners[c.name] = result;
  touch();
  return result;
}

export interface BuildOptions {
  cities: string[];
  startCity?: string;
  startDate?: string; // yyyy-mm-dd
  gapDays?: number;
  /** Keep `cities` in the given order (grid edits) instead of optimising the route. */
  keepOrder?: boolean;
}

export function buildItinerary(act: Act, plan: Plan, policy: Policy, opts: BuildOptions, mode = plan.mode): Itinerary {
  const stopsIn = opts.cities.map((name) => {
    const ranked = plan.candidates.find((x) => x.city.toLowerCase() === name.toLowerCase());
    const c = findCity(name);
    if (!c) throw new Error(`Unknown city "${name}".`);
    return { c, ranked };
  });
  if (stopsIn.length === 0) throw new Error("No cities to route.");
  const points = stopsIn.map(({ c }) => ({ lat: c.lat, lon: c.lon }));
  const startIdx = opts.startCity ? stopsIn.findIndex(({ c }) => c.name.toLowerCase() === opts.startCity!.toLowerCase()) : -1;
  const order = opts.keepOrder ? points.map((_, i) => i) : routeOrder(points, startIdx >= 0 ? startIdx : undefined);
  const start = opts.startDate ? new Date(opts.startDate + "T00:00:00Z") : nextMonthStart();
  const dates = showDates(start, order.length, opts.gapDays ?? policy.minGapDays);
  const stops: Stop[] = order.map((idx, i) => {
    const { c, ranked } = stopsIn[idx];
    const p = plan.partners[c.name];
    const prev = i > 0 ? stopsIn[order[i - 1]].c : undefined;
    return { order: i + 1, city: c.name, country: c.country, lat: c.lat, lon: c.lon, date: dates[i], score: ranked?.score ?? 0, venue: p?.recommendedVenue, opener: p?.openers[0], brand: p?.brands[0], legKm: prev ? Math.round(pathKm([{ lat: prev.lat, lon: prev.lon }, { lat: c.lat, lon: c.lon }])) : 0 };
  });
  const itinerary: Itinerary = {
    id: `tour_${Date.now().toString(36)}`,
    act,
    stops,
    totalKm: Math.round(stops.reduce((a, s) => a + s.legKm, 0)),
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    estimatedCostUsd: stops.reduce((a, s) => a + (s.venue?.estimatedCostUsd ?? 0), 0),
    builtAt: new Date().toISOString(),
    mode,
  };
  plan.itinerary = itinerary;
  touch();
  return itinerary;
}

function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function explainChoice(plan: Plan, city: string): { city: string; explanation: string; contributions: Contribution[]; score?: number } {
  const ranked = plan.candidates.find((x) => x.city.toLowerCase() === city.toLowerCase());
  const p = plan.partners[ranked?.city ?? city];
  if (!ranked && !p) throw new Error(`Nothing known about "${city}" yet; rank cities or pick partners first.`);
  const contributions = p?.recommendedVenue?.explainability ?? [];
  const lines: string[] = [];
  if (ranked) lines.push(`${ranked.city} ranked #${ranked.rank} of ${plan.candidates.length} candidates with ${Math.round(ranked.score * 100)}% affinity (mean of the top ${ranked.topCells.length} heatmap cells, ${ranked.cells} cells sampled).`);
  if (ranked?.excluded) lines.push(`It is excluded (${ranked.excludedReason ?? "by you"}), so it will not be routed.`);
  if (p) lines.push(p.why);
  if (contributions.length) lines.push(`Explainability for ${p?.recommendedVenue?.name}: ` + contributions.map((c) => `${c.label ?? c.signal} ${Math.round(c.score * 100)}%`).join(", ") + ".");
  const stop = plan.itinerary?.stops.find((s) => s.city === (ranked?.city ?? city));
  if (stop) lines.push(`Routed as stop ${stop.order} on ${stop.date}${stop.legKm ? `, ${stop.legKm} km from the previous stop` : ""}.`);
  return { city: ranked?.city ?? city, explanation: lines.join(" "), contributions, score: ranked?.score };
}

/** Mark/unmark a city in the candidate grid. */
export function excludeCity(plan: Plan, city: string, excluded: boolean, reason?: string): RankedCity | undefined {
  const c = plan.candidates.find((x) => x.city.toLowerCase() === city.toLowerCase());
  if (!c) return undefined;
  c.excluded = excluded || undefined;
  c.excludedReason = excluded ? (reason ?? "excluded by you") : undefined;
  touch();
  return c;
}

export function currentPlan(): Plan {
  return getStore().plan;
}
