/**
 * FixtureQloo: a synthetic, deterministic stand-in for the Qloo API so the whole product runs with no key.
 *
 * NOTHING in this file is Qloo data. Every artist, venue, brand and affinity score is generated from a
 * hash of the request, with a small catalogue of invented names so results read naturally. The hackathon
 * rules forbid committing real Qloo responses, and the project rule is "no fabricated data presented as
 * real": every fixture result is tagged `mode: "fixture"` and the UI labels it as synthetic.
 *
 * Shapes match the live adapter exactly (same parse path), so a key swaps the data source and nothing else.
 */
import { CITIES, findCity, type City } from "../tour/cities";
import type { Contribution, EntityType, HeatmapParams, HeatmapResult, InsightEntity, InsightsParams, InsightsResult, QlooAdapter, SearchHit } from "./types";

/* ---------------- deterministic randomness ---------------- */

/** FNV-1a 32-bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Uniform [0,1) from a string seed. */
export function unit(seed: string): number {
  return hash(seed) / 0x1_0000_0000;
}

const pick = <T>(seed: string, list: readonly T[]): T => list[hash(seed) % list.length];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/* ---------------- invented catalogue ---------------- */

export interface FixtureArtist {
  name: string;
  genre: string;
  /** Regions where this (fictional) act over-indexes; drives the synthetic affinity so rankings look plausible. */
  home: City["region"][];
  kind: "artist" | "comedian" | "podcast";
}

/** All fictional. Any other query also works: an entity is synthesised for the exact query string. */
export const FIXTURE_ARTISTS: FixtureArtist[] = [
  { name: "Nova Reyes", genre: "indie pop", home: ["North America"], kind: "artist" },
  { name: "The Velvet Antlers", genre: "alt rock", home: ["North America", "UK & Ireland"], kind: "artist" },
  { name: "DJ Halcyon", genre: "house / electronic", home: ["Europe"], kind: "artist" },
  { name: "Marisol Vega", genre: "latin pop", home: ["Latin America", "North America"], kind: "artist" },
  { name: "Ironwood Choir", genre: "folk", home: ["UK & Ireland", "Oceania"], kind: "artist" },
  { name: "Max Ortega", genre: "stand-up comedy", home: ["North America"], kind: "comedian" },
  { name: "Priya Lund", genre: "stand-up comedy", home: ["UK & Ireland", "Europe"], kind: "comedian" },
  { name: "Night Shift Radio", genre: "true-crime podcast", home: ["North America", "Oceania"], kind: "podcast" },
  { name: "Kestrel & Co.", genre: "jazz fusion", home: ["Europe", "North America"], kind: "artist" },
  { name: "Lowtide", genre: "hip hop", home: ["North America"], kind: "artist" },
];

const VENUE_SUFFIX = ["Civic Hall", "Ballroom", "Music Hall", "Theatre", "Amphitheater", "Warehouse", "Pavilion", "Auditorium", "Social Club", "Armory"];
const VENUE_PREFIX = ["The Foundry", "Harbor", "Union", "Granite", "Meridian", "Northgate", "Ember", "Lantern", "Summit", "Riverside", "Copper", "Beacon"];
const BRAND_NAMES = ["Northline Coffee", "Halo Hard Seltzer", "Saltwater Denim", "Lumen Headphones", "Tall Pine Outfitters", "Marrow Street Food", "Orbit Energy", "Sundial Sunglasses", "Fieldnote Stationery", "Quarry Bikes", "Juniper Skincare", "Flatiron Taproom"];
const BRAND_CATEGORY = ["coffee", "beverage", "apparel", "audio", "outdoor", "food", "energy drink", "eyewear", "stationery", "cycling", "skincare", "beer"];
const OPENER_FIRST = ["Juno", "Cass", "Rio", "Mabel", "Tide", "Vesper", "Oriel", "Sage", "Harlow", "Nico", "Wren", "Ash"];
const OPENER_LAST = ["Vale", "Marlow", "& The Static", "Okafor", "Frost", "Delgado", "Lune", "Hollis", "Ritter", "Ng", "Paxton", "Sol"];
const PLACE_TAGS = ["urn:tag:genre:place:music_venue", "urn:tag:genre:place:bar", "urn:tag:genre:place:restaurant", "urn:tag:genre:place:nightclub"];

export const FIXTURE_ID_PREFIX = "fx:";

export function fixtureArtistId(name: string): string {
  return `${FIXTURE_ID_PREFIX}artist:${slug(name)}`;
}

function artistFor(id: string): FixtureArtist {
  const known = FIXTURE_ARTISTS.find((a) => fixtureArtistId(a.name) === id);
  if (known) return known;
  const name = id.replace(/^fx:artist:/, "").replace(/-/g, " ");
  return { name, genre: pick(id + ":genre", ["pop", "rock", "electronic", "hip hop", "country", "comedy"]), home: [pick(id + ":home", ["North America", "Europe", "UK & Ireland"]) as City["region"]], kind: "artist" };
}

/** Synthetic affinity of a city's population with an act: a home-region bump + a hashed spread. Deterministic. */
export function cityAffinity(artistId: string, city: City): number {
  const a = artistFor(artistId);
  const base = a.home.includes(city.region) ? 0.55 : 0.25;
  const spread = unit(`${artistId}|${city.name}`) * 0.4;
  const size = Math.min(city.metroM, 10) / 100; // bigger metros nudge up, max +0.1
  return Math.min(0.99, Number((base + spread + size).toFixed(3)));
}

function contributions(signalIds: string[], affinity: number, seed: string): Contribution[] {
  // Spread the affinity across the signals, first signal dominant.
  const weights = signalIds.map((id, i) => 1 / (i + 1) + unit(`${seed}|${id}`) * 0.3);
  const total = weights.reduce((a, b) => a + b, 0);
  return signalIds.map((id, i) => ({ signal: id, label: id.startsWith(FIXTURE_ID_PREFIX) ? artistFor(id).name : undefined, score: Number(((weights[i] / total) * affinity).toFixed(3)) }));
}

function resolveCity(loc: InsightsParams["location"]): City {
  if (!loc) return CITIES[0];
  if ("query" in loc) return findCity(loc.query) ?? CITIES[0];
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - loc.latitude) ** 2 + (c.lon - loc.longitude) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function venue(city: City, artistId: string, i: number, explain: boolean, signals: string[]): InsightEntity {
  const seed = `${artistId}|${city.name}|venue|${i}`;
  const name = i === 0 ? `${city.name} ${pick(seed, VENUE_SUFFIX)}` : `${pick(seed + "p", VENUE_PREFIX)} ${pick(seed + "s", VENUE_SUFFIX)}`;
  const capacity = [900, 1400, 1800, 2200, 2800, 3500, 4200, 5500, 7500][hash(seed + "cap") % 9];
  const affinity = Number(Math.max(0.2, cityAffinity(artistId, city) - i * 0.06 + unit(seed) * 0.08).toFixed(3));
  const rentUsd = Math.round((capacity * (6 + unit(seed + "rent") * 6)) / 100) * 100;
  return {
    entity_id: `${FIXTURE_ID_PREFIX}place:${slug(city.name)}:${slug(name)}`,
    name,
    type: "urn:entity:place",
    subtype: "urn:entity:place:music_venue",
    affinity,
    popularity: Number((0.4 + unit(seed + "pop") * 0.5).toFixed(3)),
    geo: { latitude: city.lat + (unit(seed + "lat") - 0.5) * 0.08, longitude: city.lon + (unit(seed + "lon") - 0.5) * 0.08 },
    address: `${100 + (hash(seed + "addr") % 900)} ${pick(seed + "st", ["Main St", "Market St", "Union Ave", "Harbor Rd", "5th Ave", "King St"])}, ${city.name}`,
    properties: { capacity, estimated_rent_usd: rentUsd, synthetic: true },
    tags: [PLACE_TAGS[0], ...(unit(seed + "bar") > 0.5 ? [PLACE_TAGS[1]] : [])],
    explainability: explain ? contributions(signals, affinity, seed) : undefined,
  };
}

function brand(city: City, artistId: string, i: number, explain: boolean, signals: string[]): InsightEntity {
  const seed = `${artistId}|${city.name}|brand|${i}`;
  const idx = (hash(seed) + i * 5) % BRAND_NAMES.length;
  const name = BRAND_NAMES[idx];
  const affinity = Number(Math.max(0.15, cityAffinity(artistId, city) - 0.05 - i * 0.05 + unit(seed) * 0.1).toFixed(3));
  return {
    entity_id: `${FIXTURE_ID_PREFIX}brand:${slug(name)}`,
    name,
    type: "urn:entity:brand",
    subtype: "urn:entity:brand",
    affinity,
    popularity: Number((0.3 + unit(seed + "pop") * 0.6).toFixed(3)),
    properties: { category: BRAND_CATEGORY[idx], headquartered_in: city.name, synthetic: true },
    tags: [`urn:tag:category:brand:${slug(BRAND_CATEGORY[idx])}`],
    explainability: explain ? contributions(signals, affinity, seed) : undefined,
  };
}

function opener(city: City | undefined, artistId: string, i: number, explain: boolean, signals: string[], trends?: string): InsightEntity {
  const seed = `${artistId}|${city?.name ?? "global"}|opener|${i}`;
  const name = `${pick(seed + "f", OPENER_FIRST)} ${pick(seed + "l", OPENER_LAST)}`;
  const a = artistFor(artistId);
  const affinity = Number(Math.max(0.2, 0.75 - i * 0.07 + unit(seed) * 0.1 + (trends === "high" ? 0.05 : 0)).toFixed(3));
  return {
    entity_id: `${FIXTURE_ID_PREFIX}artist:${slug(name)}`,
    name,
    type: "urn:entity:artist",
    subtype: "urn:entity:artist",
    affinity,
    popularity: Number((0.1 + unit(seed + "pop") * 0.4).toFixed(3)),
    properties: { genre: a.genre, based_in: city?.name, synthetic: true },
    tags: [`urn:tag:genre:music:${slug(a.genre)}`],
    explainability: explain ? contributions(signals, affinity, seed) : undefined,
  };
}

export class FixtureQloo implements QlooAdapter {
  readonly mode = "fixture" as const;
  readonly stats = { requests: 0 };

  constructor(private readonly latencyMs = 0) {}

  private async tick() {
    this.stats.requests++;
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async search(query: string, types: EntityType[] = ["urn:entity:artist"], take = 8): Promise<SearchHit[]> {
    await this.tick();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    if (types.includes("urn:entity:artist")) {
      for (const a of FIXTURE_ARTISTS) {
        const n = a.name.toLowerCase();
        if (n.includes(q) || q.includes(n) || n.split(/\s+/).some((w) => w.startsWith(q))) {
          hits.push({ entity_id: fixtureArtistId(a.name), name: a.name, types: ["urn:entity:artist"], popularity: Number((0.5 + unit(a.name) * 0.45).toFixed(3)), hint: `${a.genre} (synthetic fixture)` });
        }
      }
      // Any name resolves: synthesise an entity for the exact query so judges can type anyone.
      if (!hits.some((h) => h.name.toLowerCase() === q)) {
        const name = query.trim().replace(/\s+/g, " ");
        const a = artistFor(fixtureArtistId(name));
        hits.push({ entity_id: fixtureArtistId(name), name, types: ["urn:entity:artist"], popularity: Number((0.2 + unit(name) * 0.6).toFixed(3)), hint: `${a.genre} (synthetic fixture)` });
      }
    }
    return hits.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, take);
  }

  async insights(p: InsightsParams): Promise<InsightsResult> {
    await this.tick();
    const take = p.take ?? 10;
    const explain = !!p.explainability;
    const signals = p.signalEntities;
    const artistId = signals[0] ?? "fx:artist:unknown";
    const city = p.location ? resolveCity(p.location) : undefined;
    let entities: InsightEntity[];
    if (p.type === "urn:entity:place") entities = Array.from({ length: take }, (_, i) => venue(city ?? CITIES[0], artistId, i, explain, signals));
    else if (p.type === "urn:entity:brand") entities = Array.from({ length: take }, (_, i) => brand(city ?? CITIES[0], artistId, i, explain, signals));
    else entities = Array.from({ length: take }, (_, i) => opener(city, artistId, i, explain, signals, p.trends));
    if (p.excludeEntities?.length) entities = entities.filter((e) => !p.excludeEntities!.includes(e.entity_id));
    // De-duplicate names (the brand catalogue is small) and sort by affinity, like Qloo does.
    const seen = new Set<string>();
    entities = entities.filter((e) => (seen.has(e.entity_id) ? false : (seen.add(e.entity_id), true))).sort((a, b) => b.affinity - a.affinity);
    return { entities, query: { fixture: true, params: p } };
  }

  async heatmap(p: HeatmapParams): Promise<HeatmapResult> {
    await this.tick();
    const city = resolveCity(p.location);
    const artistId = p.signalEntities[0] ?? "fx:artist:unknown";
    const base = cityAffinity(artistId, city);
    const n = Math.min(p.take ?? 24, 48);
    const cells = Array.from({ length: n }, (_, i) => {
      const seed = `${artistId}|${city.name}|cell|${i}`;
      const affinity = Number(Math.min(0.99, Math.max(0.05, base + (unit(seed) - 0.5) * 0.3)).toFixed(3));
      return { latitude: Number((city.lat + (unit(seed + "lat") - 0.5) * 0.3).toFixed(4)), longitude: Number((city.lon + (unit(seed + "lon") - 0.5) * 0.3).toFixed(4)), affinity, popularity: Number((0.2 + unit(seed + "pop") * 0.7).toFixed(3)) };
    }).sort((a, b) => b.affinity - a.affinity);
    cells.forEach((c, i) => Object.assign(c, { affinity_rank: Number((1 - i / n).toFixed(3)) }));
    return { cells, raw: { fixture: true } };
  }
}
