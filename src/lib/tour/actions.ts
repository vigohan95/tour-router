/**
 * The things the agent can do, as plain async functions over the Qloo adapter and the store.
 * The AI SDK tools in ../agent/tools.ts wrap these; the UI can also call them directly (same code path).
 *
 * Qloo usage (verified against hackathon.api.qloo.com on 2026-10-13, see docs/LIVE-NOTES.md):
 *   resolveArtist  GET /search?types=urn:entity:artist,urn:entity:person
 *   rankCities     GET /v2/insights?filter.type=urn:heatmap&filter.location.query=<country>  (ONE map per country,
 *                  cells binned to the candidate cities; per-city maps are normalised inside their own area and
 *                  cannot be compared, see docs/LIVE-NOTES.md "ranking")
 *   pickPartners   GET /v2/insights filter.type=urn:entity:place (+ filter.location.query + filter.tags),
 *                  urn:entity:brand / urn:entity:artist|person (+ signal.location.query, bias.trends, feature.explainability)
 */
import { getQloo } from "../qloo";
import type { Contribution, HeatmapCell, QlooAdapter, SearchHit } from "../qloo/types";
import type { Policy } from "../policy/schema";
import { heldFor, isExcluded } from "../policy/schema";
import { getStore, touch } from "../store";
import { COUNTRY_QUERY, citiesIn, findCity, qlooLocality, type City, type Region } from "./cities";
import { haversineKm, pathKm, routeOrder, showDates } from "./route";
import { partnerFromEntity, type Act, type CityPartners, type CoBill, type Itinerary, type Partner, type Plan, type RankedCity, type Stop, type TourOpenerCandidate } from "./types";

/** Heatmap cells within this distance of a city centre count for that city (country maps are geohash-4/5, ~20-40 km cells). */
export const HEATMAP_RADIUS_KM = 60;
/** The city score is the mean of its strongest cells. */
export const TOP_CELLS = 5;
/** Venue tags that exist on the live API (verified 2026-10-13); `filter.tags` is a union. */
export const VENUE_TAGS = ["urn:tag:genre:place:live_music_venue", "urn:tag:genre:place:concert_hall", "urn:tag:genre:place:amphitheater", "urn:tag:genre:place:arena", "urn:tag:genre:place:performing_arts_theater"];
/** Comedians (urn:entity:person) also get comedy clubs. */
export const COMEDY_VENUE_TAGS = ["urn:tag:genre:place:comedy_club", ...VENUE_TAGS];
/** Tag ids / names that mark a comedian ("american_stand_up_comedians", "Comedian", "21st-century American Comedians"); a bare "Comedy" genre tag is not enough (actors in comedies carry it). */
export const COMEDY_TAG = /stand[- _]?up|comedian/i;

function isComedian(h: SearchHit): boolean {
  return h.types.includes("urn:entity:person") && (h.tagIds ?? []).some((t) => COMEDY_TAG.test(t));
}

/**
 * Search musicians and persons at once. Live Qloo returns the same name under both types (Taylor Swift, John
 * Mulaney); the artist entity carries the listening signal for musicians, the person entity carries the comedy
 * tags and the heatmap signal for comedians (Mulaney's artist entity has an empty heatmap). So: a person hit with a
 * comedy tag is preferred over the same-named artist; otherwise the artist comes first and the person is dropped.
 */
export async function resolveArtist(query: string, qloo: QlooAdapter = getQloo()): Promise<{ query: string; hits: Act[]; mode: string }> {
  const raw = await qloo.search(query, ["urn:entity:artist", "urn:entity:person"], 10);
  const byName = new Map<string, SearchHit[]>();
  for (const h of raw) byName.set(h.name.toLowerCase(), [...(byName.get(h.name.toLowerCase()) ?? []), h]);
  const hits: Act[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const group = byName.get(h.name.toLowerCase()) ?? [h];
    const comedian = group.find(isComedian);
    const artist = group.find((g) => g.types.includes("urn:entity:artist"));
    const chosen = comedian ?? artist ?? h;
    if (seen.has(chosen.entity_id)) continue;
    seen.add(chosen.entity_id);
    const kind = chosen.types.includes("urn:entity:person") ? "person" : "artist";
    hits.push({ entity_id: chosen.entity_id, name: chosen.name, kind, hint: `${kind === "person" ? (comedian ? "comedian" : "person") : "artist"}${chosen.hint ? ` - ${chosen.hint}` : ""}`, popularity: chosen.popularity });
  }
  return { query, hits: hits.slice(0, 6), mode: qloo.mode };
}

/** Pick an act and reset the plan around it. */
export function setAct(plan: Plan, act: Act) {
  if (plan.act?.entity_id !== act.entity_id) {
    plan.candidates = [];
    plan.partners = {};
    plan.itinerary = undefined;
    plan.previousItinerary = undefined;
    plan.compare = undefined;
    plan.coBill = undefined;
  }
  plan.act = act;
  touch();
}

/** Mean of the strongest cells (0 for none). */
export function aggregateHeatmap(cells: { affinity: number }[], top = TOP_CELLS): number {
  if (cells.length === 0) return 0;
  const sorted = [...cells].sort((a, b) => b.affinity - a.affinity).slice(0, top);
  return Number((sorted.reduce((a, c) => a + c.affinity, 0) / sorted.length).toFixed(4));
}

/** Min-max rescale of the scores to 0..100 across the candidates (cities without a signal get 0). */
export function indexScores<T extends { score: number; noSignal?: boolean }>(rows: T[]): (T & { index: number })[] {
  const vals = rows.filter((r) => !r.noSignal).map((r) => r.score);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return rows.map((r) => ({ ...r, index: r.noSignal ? 0 : vals.length < 2 || max === min ? 100 : Math.round(((r.score - min) / (max - min)) * 100) }));
}

/** Bin one country-wide heatmap to a city: the cells within HEATMAP_RADIUS_KM, strongest first. */
export function cellsNear(city: { lat: number; lon: number }, cells: HeatmapCell[], radiusKm = HEATMAP_RADIUS_KM): HeatmapCell[] {
  return cells.filter((h) => haversineKm({ lat: city.lat, lon: city.lon }, { lat: h.latitude, lon: h.longitude }) <= radiusKm).sort((a, b) => b.affinity - a.affinity);
}

/** 1-based ranks (ties keep input order), returned in input order. */
function ranksBy<T>(rows: T[], value: (r: T) => number): number[] {
  const order = rows.map((r, i) => ({ i, v: value(r) })).sort((a, b) => b.v - a.v || a.i - b.i);
  const ranks = new Array<number>(rows.length);
  order.forEach((o, pos) => (ranks[o.i] = pos + 1));
  return ranks;
}

export interface RankOptions {
  regions?: Region[];
  limit?: number;
  /** Only these cities (names) are considered when given. */
  only?: string[];
}

/**
 * Rank candidate cities from ONE heatmap per country (cached), binned to the cities. Scores are comparable
 * inside a country (Qloo normalises affinity inside the queried area); across countries they are each
 * normalised to their own country, which the grid note says.
 */
export async function rankCities(act: Act, policy: Policy, opts: RankOptions = {}, qloo: QlooAdapter = getQloo()): Promise<RankedCity[]> {
  const regions = opts.regions?.length ? opts.regions : (policy.regions as Region[]);
  let pool: City[] = citiesIn(regions);
  if (opts.only?.length) {
    const wanted = opts.only.map((c) => findCity(c)).filter((c): c is City => !!c);
    if (wanted.length) pool = wanted;
  }
  const countries = [...new Set(pool.map((c) => c.country))];
  const maps = new Map<string, { cells: HeatmapCell[]; error?: string }>();
  await Promise.all(
    countries.map(async (code) => {
      const query = COUNTRY_QUERY[code] ?? code;
      try {
        const hm = await qloo.heatmap({ signalEntities: [act.entity_id], location: { query } });
        maps.set(code, { cells: hm.cells });
      } catch (e) {
        // Not a zero: Qloo did not answer for this country. Its cities stay visible, unscored, with the reason.
        maps.set(code, { cells: [], error: `Qloo error: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}` });
      }
    }),
  );
  type Scored = { city: string; country: string; region: Region; lat: number; lon: number; cells: number; topCells: HeatmapCell[]; score: number; popularity: number; noSignal?: boolean; note?: string };
  const scored: Scored[] = pool.map((city) => {
    const m = maps.get(city.country)!;
    const near = cellsNear(city, m.cells);
    const base = { city: city.name, country: city.country, region: city.region, lat: city.lat, lon: city.lon, cells: near.length, topCells: near.slice(0, TOP_CELLS) };
    if (m.error) return { ...base, score: 0, popularity: 0, noSignal: true, note: m.error };
    if (near.length === 0) return { ...base, score: 0, popularity: 0, noSignal: true, note: "no Qloo signal within 60 km" };
    const top = near.slice(0, TOP_CELLS);
    const popularity = Number((top.reduce((a, c) => a + (c.popularity ?? 0), 0) / top.length).toFixed(4));
    return { ...base, score: aggregateHeatmap(near), popularity, note: countries.length > 1 ? `normalised within ${COUNTRY_QUERY[city.country] ?? city.country}` : undefined };
  });
  const popRanks = ranksBy(scored, (r) => (r.noSignal ? -1 : r.popularity));
  const sizeRanks = ranksBy(pool, (c) => c.metroM); // same order as `scored`
  const withRanks = indexScores(scored).map((r, i) => ({ ...r, popularityRank: popRanks[i], populationRank: sizeRanks[i] }));
  const ranked: RankedCity[] = withRanks
    .sort((a, b) => Number(!!a.noSignal) - Number(!!b.noSignal) || b.score - a.score || a.city.localeCompare(b.city))
    .map((c, i) => ({ ...c, rank: i + 1, lift: c.populationRank - (i + 1), excluded: isExcluded(policy, c.city) || undefined, excludedReason: isExcluded(policy, c.city) ? "policy.excludeCities" : undefined }));
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

const pct = (n: number | undefined) => (n === undefined ? "n/a" : `${Math.round(n * 100)}%`);

function liftText(r: RankedCity): string {
  if (r.lift > 0) return `#${r.rank} by taste but only #${r.populationRank} by metro size (lift +${r.lift})`;
  if (r.lift < 0) return `#${r.rank} by taste, #${r.populationRank} by metro size (lift ${r.lift})`;
  return `#${r.rank} by taste and by metro size`;
}

/** The ranking sentence that opens a city card; explain_choice states the rank itself, so it uses `whyPartners`. */
function rankSentence(act: Act, city: string, ranked: RankedCity | undefined): string | undefined {
  if (!ranked) return undefined;
  if (ranked.noSignal) return `${city}: Qloo has no affinity signal for ${act.name} here (${ranked.note ?? "no signal"}).`;
  return `${city} is ${liftText(ranked)}: ${(ranked.score * 100).toFixed(1)}% fan affinity on Qloo's ${COUNTRY_QUERY[ranked.country] ?? ranked.country} heatmap (${ranked.cells} cells within 60 km), listener density ${pct(ranked.popularity)}.`;
}

function whyText(act: Act, city: string, venues: Partner[], recommended: Partner | undefined, brands: Partner[], openers: Partner[], ranked: RankedCity | undefined): { why: string; whyPartners: string } {
  const top = (c?: Contribution[]) => c?.slice().sort((a, b) => b.score - a.score)[0];
  const parts: string[] = [];
  if (recommended) {
    const t = top(recommended.explainability);
    const runnerUp = venues.find((v) => v.entity_id !== recommended.entity_id);
    parts.push(`${recommended.name} (${recommended.detail ?? "venue"}${recommended.capacity ? `, ${recommended.capacity.toLocaleString("en-US")} cap` : ""}) has the strongest crowd overlap with the act, ${pct(recommended.affinity)}${runnerUp ? ` vs ${runnerUp.name} ${pct(runnerUp.affinity)}` : ""}${t ? `; the ${t.label ?? "act"} signal carries ${pct(t.score)} of it` : ""}.`);
  }
  if (brands[0]) parts.push(`${brands[0].name} (${brands[0].detail}) is the brand this city's audience and the act's fans both over-index on${brands[1] ? `, ahead of ${brands[1].name} (${pct(brands[1].affinity)} vs ${pct(brands[0].affinity)})` : ""}.`);
  if (openers[0]) parts.push(`${openers[0].name} (${openers[0].detail}) is the trending ${act.kind === "person" ? "comic" : "act"} with the highest cross-affinity for this market, ${pct(openers[0].affinity)}.`);
  const whyPartners = parts.join(" ");
  const rs = rankSentence(act, city, ranked);
  return { why: [rs, whyPartners].filter(Boolean).join(" "), whyPartners };
}

export async function pickPartners(act: Act, city: string, policy: Policy, plan: Plan, qloo: QlooAdapter = getQloo()): Promise<CityPartners> {
  const c = findCity(city);
  if (!c) throw new Error(`Unknown city "${city}". Use one of the ranked candidate cities.`);
  const signal = [act.entity_id];
  const loc = { query: qlooLocality(c) };
  const labels = { [act.entity_id]: act.name };
  const comedian = act.kind === "person";
  const [venues, brands, openers] = await Promise.all([
    // Places: filter.location.query bounds the city; the act is the taste signal.
    qloo.insights({ type: "urn:entity:place", signalEntities: signal, location: loc, tags: comedian ? COMEDY_VENUE_TAGS : VENUE_TAGS, take: 10, explainability: true }),
    // Brands / openers: filter.location is ignored for these types (verified); signal.location.query weights by the city's own taste.
    qloo.insights({ type: "urn:entity:brand", signalEntities: signal, signalLocation: loc, take: 5, explainability: true }),
    comedian
      ? qloo.insights({ type: "urn:entity:person", signalEntities: signal, signalLocation: loc, take: 30, explainability: true, trends: "high", excludeEntities: [act.entity_id] })
      : qloo.insights({ type: "urn:entity:artist", signalEntities: signal, signalLocation: loc, take: 5, explainability: true, trends: "high", excludeEntities: [act.entity_id] }),
  ]);
  // filter.tags is a union over every tag on the place, so galleries or malls with a secondary "live music" tag come back too;
  // places whose PRIMARY genre is a venue genre go first (stable: Qloo's affinity order inside each group).
  const venueGenres = new Set(comedian ? COMEDY_VENUE_TAGS : VENUE_TAGS);
  const isVenue = (p: Partner) => (p.subtype ? venueGenres.has(p.subtype) : false);
  const v = venues.entities.map((e) => partnerFromEntity(e, labels)).sort((a, b) => Number(isVenue(b)) - Number(isVenue(a)));
  const inWindow = v.filter((x) => x.capacity === undefined || (x.capacity >= policy.venue.minCapacity && x.capacity <= policy.venue.maxCapacity));
  const recommendedVenue = inWindow[0] ?? v[0];
  const b = brands.entities.map((e) => partnerFromEntity(e, labels));
  // Persons come back as any kind of public figure; keep the ones tagged as comedians (Qloo has no person-type comedian filter that returns results).
  const comedians = comedian ? openers.entities.filter((e) => e.tags.some((t) => COMEDY_TAG.test(t))).slice(0, 5) : [];
  const openerEntities = comedian ? (comedians.length ? comedians : openers.entities.slice(0, 5)) : openers.entities;
  const o = openerEntities.map((e) => partnerFromEntity(e, labels));
  const ranked = plan.candidates.find((x) => x.city === c.name);
  const result: CityPartners = { city: c.name, venues: v, brands: b, openers: o, recommendedVenue, ...whyText(act, c.name, v, recommendedVenue, b, o, ranked), mode: qloo.mode };
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

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The venue a held stop carries: the Qloo venue card whose name overlaps the promoter's text when there is one
 * (so affinity and explainability stay visible), otherwise a plain promoter hold with no Qloo score.
 */
export function heldVenue(venueName: string, venues: Partner[] = []): Partner {
  const want = normName(venueName);
  const match = venues.find((v) => {
    const have = normName(v.name);
    return have === want || have.includes(want) || want.includes(have);
  });
  if (match) return { ...match, held: true };
  return { entity_id: `held:${want}`, name: venueName, affinity: 0, detail: "promoter hold, not a Qloo result", held: true };
}

/**
 * Pure: route + date the cities with the plan's partners, without storing anything.
 *
 * Scheduling rules (all from the policy, i.e. the promoter's own inputs):
 *  - held stops (policy.heldVenues) are anchored on their date and carry the held venue, flagged HELD;
 *  - free stops take the next dates in route order, at least minGapDays apart, never on a blackout date and never
 *    within the gap of a held date;
 *  - the itinerary is then ordered by date, so a hold can pull a city earlier or later than geography alone would.
 */
export function makeItinerary(act: Act, plan: Plan, policy: Policy, opts: BuildOptions, mode = plan.mode, now = new Date()): Itinerary {
  const stopsIn = opts.cities.map((name) => {
    const ranked = plan.candidates.find((x) => x.city.toLowerCase() === name.toLowerCase());
    const c = findCity(name);
    if (!c) throw new Error(`Unknown city "${name}".`);
    return { c, ranked, hold: heldFor(policy, c.name) };
  });
  if (stopsIn.length === 0) throw new Error("No cities to route.");
  const points = stopsIn.map(({ c }) => ({ lat: c.lat, lon: c.lon }));
  const startIdx = opts.startCity ? stopsIn.findIndex(({ c }) => c.name.toLowerCase() === opts.startCity!.toLowerCase()) : -1;
  const order = opts.keepOrder ? points.map((_, i) => i) : routeOrder(points, startIdx >= 0 ? startIdx : undefined);
  const start = opts.startDate ? new Date(opts.startDate + "T00:00:00Z") : nextMonthStart(now);
  const gap = opts.gapDays ?? policy.minGapDays;
  const freeOrder = order.filter((idx) => !stopsIn[idx].hold);
  const heldDates = stopsIn.filter((s) => s.hold).map((s) => s.hold!.date);
  const freeDates = showDates(start, freeOrder.length, gap, { blackout: policy.blackoutDates, avoid: heldDates });
  const dated = [...freeOrder.map((idx, i) => ({ idx, date: freeDates[i] })), ...order.filter((idx) => stopsIn[idx].hold).map((idx) => ({ idx, date: stopsIn[idx].hold!.date }))];
  // Chronological order; among equal dates (only possible between two holds) keep route order.
  const seq = dated.map((d, pos) => ({ ...d, pos })).sort((a, b) => a.date.localeCompare(b.date) || a.pos - b.pos);
  const stops: Stop[] = seq.map(({ idx, date }, i) => {
    const { c, ranked, hold } = stopsIn[idx];
    const p = plan.partners[c.name];
    const prev = i > 0 ? stopsIn[seq[i - 1].idx].c : undefined;
    const venue = hold ? heldVenue(hold.venue, p?.venues) : p?.recommendedVenue;
    return { order: i + 1, city: c.name, country: c.country, lat: c.lat, lon: c.lon, date, score: ranked?.score ?? 0, venue, opener: p?.openers[0], brand: p?.brands[0], legKm: prev ? Math.round(pathKm([{ lat: prev.lat, lon: prev.lon }, { lat: c.lat, lon: c.lon }])) : 0, held: hold ? true : undefined };
  });
  return {
    id: `tour_${now.getTime().toString(36)}`,
    act,
    stops,
    totalKm: Math.round(stops.reduce((a, s) => a + s.legKm, 0)),
    startDate: stops[0].date,
    endDate: stops[stops.length - 1].date,
    estimatedCostUsd: stops.reduce((a, s) => a + (s.venue?.estimatedCostUsd ?? 0), 0),
    startCity: startIdx >= 0 ? stopsIn[startIdx].c.name : undefined,
    gapDays: opts.gapDays,
    builtAt: now.toISOString(),
    mode,
  };
}

/** Build and store the itinerary; the one it replaces is kept as `previousItinerary` for compare_plans. */
export function buildItinerary(act: Act, plan: Plan, policy: Policy, opts: BuildOptions, mode = plan.mode): Itinerary {
  const itinerary = makeItinerary(act, plan, policy, opts, mode);
  if (plan.itinerary) plan.previousItinerary = plan.itinerary;
  plan.itinerary = itinerary;
  plan.compare = undefined;
  touch();
  return itinerary;
}

function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function explainChoice(plan: Plan, city: string): { city: string; explanation: string; contributions: Contribution[]; score?: number; lift?: number } {
  const ranked = plan.candidates.find((x) => x.city.toLowerCase() === city.toLowerCase());
  const p = plan.partners[ranked?.city ?? city];
  if (!ranked && !p) throw new Error(`Nothing known about "${city}" yet; rank cities or pick partners first.`);
  const contributions = p?.recommendedVenue?.explainability ?? [];
  const lines: string[] = [];
  if (ranked?.noSignal) lines.push(`${ranked.city} is #${ranked.rank} of ${plan.candidates.length} candidates but unscored: ${ranked.note ?? "Qloo has no signal for the act there"}.`);
  else if (ranked) lines.push(`${ranked.city} ranks ${liftText(ranked)} among ${plan.candidates.length} candidates: ${(ranked.score * 100).toFixed(1)}% fan affinity (mean of the ${ranked.topCells.length} strongest cells of Qloo's ${COUNTRY_QUERY[ranked.country] ?? ranked.country} heatmap within 60 km, ${ranked.cells} cells in range; index ${ranked.index}/100 across the candidates), listener density ${pct(ranked.popularity)} (#${ranked.popularityRank}).`);
  if (ranked?.excluded) lines.push(`It is excluded (${ranked.excludedReason ?? "by you"}), so it will not be routed.`);
  // The card's first sentence is the same ranking statement as above; keep only the partner sentences here.
  if (p && (p.whyPartners ?? p.why)) lines.push(p.whyPartners ?? p.why);
  if (contributions.length) lines.push(`Explainability for ${p?.recommendedVenue?.name}: ` + contributions.map((c) => `${c.label ?? c.signal} ${Math.round(c.score * 100)}%`).join(", ") + ".");
  const stop = plan.itinerary?.stops.find((s) => s.city === (ranked?.city ?? city));
  if (stop) lines.push(`Routed as stop ${stop.order} on ${stop.date}${stop.legKm ? `, ${stop.legKm} km from the previous stop` : ""}.`);
  const swappedOut = plan.compare?.swappedOut.find((s) => s.city === (ranked?.city ?? city));
  const swappedIn = plan.compare?.swappedIn.find((s) => s.city === (ranked?.city ?? city));
  if (swappedIn) lines.push(`A ${plan.compare!.against}-only route would not include it; taste put it in.`);
  if (swappedOut) lines.push(`A ${plan.compare!.against}-only route would include it; taste dropped it.`);
  return { city: ranked?.city ?? city, explanation: lines.join(" "), contributions, score: ranked?.score, lift: ranked?.lift };
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

/* ---------------- tour opener + co-bill markets ---------------- */

/**
 * Rank the acts that recur across the routed cities' opener lists (the lists pickPartners already fetched with
 * signal.location.query per city): by stops appeared in, then mean affinity. No Qloo call.
 */
export function tourOpenerCandidates(plan: Plan, cities: string[]): TourOpenerCandidate[] {
  const seen = new Map<string, { p: Partner; cities: string[]; affinities: number[] }>();
  for (const city of cities) {
    for (const o of plan.partners[city]?.openers ?? []) {
      const e = seen.get(o.entity_id) ?? { p: o, cities: [], affinities: [] };
      e.cities.push(city);
      e.affinities.push(o.affinity);
      seen.set(o.entity_id, e);
    }
  }
  return [...seen.values()]
    .map((e) => ({ entity_id: e.p.entity_id, name: e.p.name, detail: e.p.detail, stopsAppeared: e.cities.length, ofStops: cities.length, meanAffinity: Number((e.affinities.reduce((a, b) => a + b, 0) / e.affinities.length).toFixed(4)), cities: e.cities }))
    .sort((a, b) => b.stopsAppeared - a.stopsAppeared || b.meanAffinity - a.meanAffinity || a.name.localeCompare(b.name));
}

export interface TourOpenerOptions {
  /** Pick this candidate instead of the best one. */
  openerEntityId?: string;
  /** Cities to intersect over; defaults to the itinerary's stops, else every city with partners. */
  cities?: string[];
}

/**
 * Pick one opener for the whole run and re-score the candidate cities on the pairing: one `urn:heatmap` per
 * country with `signal.interests.entities=<headliner>,<opener>` (the live API accepts two signals; verified
 * 2026-10-13, see docs/LIVE-NOTES.md). If a country's two-signal request fails, that country falls back to the
 * mean of two single-signal maps and the result says so (`method: "averaged"`). Stores the result on the plan and
 * writes `jointScore` / `jointRank` on the candidates.
 */
export async function pickTourOpener(act: Act, plan: Plan, policy: Policy, opts: TourOpenerOptions = {}, qloo: QlooAdapter = getQloo(), now = new Date()): Promise<CoBill> {
  void policy;
  const cities = opts.cities ?? plan.itinerary?.stops.map((s) => s.city) ?? Object.keys(plan.partners);
  const withPartners = cities.filter((c) => plan.partners[c]?.openers.length);
  if (withPartners.length < 2) throw new Error("Pick partners for at least two routed cities first; the tour opener is the act that recurs across their opener lists.");
  const ranked = tourOpenerCandidates(plan, withPartners);
  if (ranked.length === 0) throw new Error("No openers were returned for these cities.");
  const chosen = (opts.openerEntityId ? ranked.find((r) => r.entity_id === opts.openerEntityId) : undefined) ?? ranked[0];
  const opener = withPartners.flatMap((c) => plan.partners[c].openers).find((o) => o.entity_id === chosen.entity_id)!;
  const locals: Record<string, string> = {};
  for (const c of withPartners) {
    const top = plan.partners[c].openers[0];
    if (top && top.entity_id !== chosen.entity_id) locals[c] = top.name;
  }
  // One joint heatmap per country already in the ranking.
  const countries = [...new Set(plan.candidates.map((c) => c.country))];
  const maps = new Map<string, { cells: HeatmapCell[]; averaged?: boolean; error?: string }>();
  await Promise.all(
    countries.map(async (code) => {
      const location = { query: COUNTRY_QUERY[code] ?? code };
      try {
        const hm = await qloo.heatmap({ signalEntities: [act.entity_id, opener.entity_id], location });
        maps.set(code, { cells: hm.cells });
      } catch (e) {
        // Honest fallback: average the two single-signal maps cell by cell (by geohash / coordinates), and say so.
        try {
          const [a, b] = await Promise.all([qloo.heatmap({ signalEntities: [act.entity_id], location }), qloo.heatmap({ signalEntities: [opener.entity_id], location })]);
          const key = (h: HeatmapCell) => h.geohash ?? `${h.latitude},${h.longitude}`;
          const bMap = new Map(b.cells.map((h) => [key(h), h]));
          const cells = a.cells.map((h) => {
            const o = bMap.get(key(h));
            return { ...h, affinity: o ? (h.affinity + o.affinity) / 2 : h.affinity / 2 };
          });
          maps.set(code, { cells, averaged: true, error: e instanceof Error ? e.message.slice(0, 80) : String(e) });
        } catch (e2) {
          maps.set(code, { cells: [], error: `Qloo error: ${e2 instanceof Error ? e2.message.slice(0, 80) : String(e2)}` });
        }
      }
    }),
  );
  const averagedCountries = [...maps.entries()].filter(([, m]) => m.averaged).map(([code]) => COUNTRY_QUERY[code] ?? code);
  const failed = [...maps.entries()].filter(([, m]) => !m.averaged && m.error).map(([code]) => COUNTRY_QUERY[code] ?? code);
  const scoredCities = plan.candidates.map((c) => {
    const m = maps.get(c.country);
    const near = m ? cellsNear(c, m.cells) : [];
    const joint = c.noSignal || !m || m.cells.length === 0 || near.length === 0 ? undefined : aggregateHeatmap(near);
    return { c, joint };
  });
  const jointRanks = ranksBy(scoredCities, (r) => (r.joint === undefined ? -1 : r.joint));
  const rows: CoBill["cities"] = [];
  scoredCities.forEach(({ c, joint }, i) => {
    c.jointScore = joint;
    c.jointRank = joint === undefined ? undefined : jointRanks[i];
    if (joint !== undefined) rows.push({ city: c.city, headliner: c.score, joint, delta: Number((joint - c.score).toFixed(4)), headlinerRank: c.rank, jointRank: jointRanks[i] });
  });
  rows.sort((a, b) => b.joint - a.joint);
  const method: CoBill["method"] = averagedCountries.length ? "averaged" : "joint";
  const methodNote =
    method === "joint"
      ? `One heatmap per country (${countries.map((c) => COUNTRY_QUERY[c] ?? c).join(", ")}) signalled by ${act.name} and ${opener.name} together (signal.interests.entities with two ids), binned to each city like the headliner map.${failed.length ? ` No joint map for ${failed.join(", ")} (Qloo error); those cities have no co-bill score.` : ""}`
      : `Qloo refused a two-signal heatmap for ${averagedCountries.join(", ")}; those countries show the mean of two single-signal maps (headliner, opener) cell by cell, which is an approximation of the joint signal, not Qloo's own co-bill affinity.`;
  const result: CoBill = { opener: { ...opener }, stopsAppeared: chosen.stopsAppeared, ofStops: chosen.ofStops, meanAffinity: chosen.meanAffinity, alternates: ranked.filter((r) => r.entity_id !== chosen.entity_id).slice(0, 5), locals, method, methodNote, cities: rows, computedAt: now.toISOString(), mode: qloo.mode };
  plan.coBill = result;
  touch();
  return result;
}

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

/** One paragraph for the agent and the panel. */
export function coBillText(act: Act, cb: CoBill): string {
  const top = cb.cities.slice(0, 5);
  const up = cb.cities.filter((r) => r.jointRank < r.headlinerRank).sort((a, b) => b.headlinerRank - b.jointRank - (a.headlinerRank - a.jointRank)).slice(0, 3);
  const down = cb.cities.filter((r) => r.jointRank > r.headlinerRank).sort((a, b) => b.jointRank - b.headlinerRank - (a.jointRank - a.headlinerRank)).slice(0, 3);
  const parts = [`Tour opener: ${cb.opener.name}${cb.opener.detail ? ` (${cb.opener.detail})` : ""}, in the top openers of ${cb.stopsAppeared} of ${cb.ofStops} routed cities, mean affinity ${pct(cb.meanAffinity)}.`];
  if (cb.alternates.length) parts.push(`Runners-up: ${cb.alternates.slice(0, 3).map((a) => `${a.name} (${a.stopsAppeared}/${a.ofStops}, ${pct(a.meanAffinity)})`).join(", ")}.`);
  const localList = Object.entries(cb.locals);
  if (localList.length) parts.push(`Local alternates where the city's own #1 differs: ${localList.map(([c, n]) => `${c}: ${n}`).join("; ")}.`);
  if (top.length) parts.push(`Co-bill markets (${act.name} + ${cb.opener.name}, ${cb.method === "joint" ? "one joint heatmap per country" : "averaged single-signal maps"}): ${top.map((r) => `${r.city} ${pct1(r.joint)} (headliner-only ${pct1(r.headliner)}, #${r.headlinerRank} -> #${r.jointRank})`).join(", ")}.`);
  if (up.length) parts.push(`The pairing lifts ${up.map((r) => `${r.city} (#${r.headlinerRank} -> #${r.jointRank})`).join(", ")}.`);
  if (down.length) parts.push(`It costs ${down.map((r) => `${r.city} (#${r.headlinerRank} -> #${r.jointRank})`).join(", ")}.`);
  return parts.join(" ");
}
