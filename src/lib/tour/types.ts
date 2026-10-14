/**
 * The tour plan the agent builds up. This is what the UI renders and what the browser carries as a snapshot.
 */
import type { Contribution, DataMode, HeatmapCell, InsightEntity } from "../qloo/types";

export type DataModeLike = DataMode;
import type { Region } from "./cities";

export interface Act {
  entity_id: string;
  name: string;
  /** Qloo entity type: musicians are urn:entity:artist, comedians / hosts are urn:entity:person. */
  kind?: "artist" | "person";
  hint?: string;
  popularity?: number;
}

export interface RankedCity {
  city: string;
  country: string;
  region: Region;
  lat: number;
  lon: number;
  /**
   * Fan affinity 0..1: mean of the strongest heatmap cells within HEATMAP_RADIUS_KM of the city, read from ONE
   * country-wide `urn:heatmap` for the act (Qloo min-max normalises affinity inside the queried area, so cells
   * from one country-wide map are comparable across its cities; per-city maps are not). 0 when no cell is in range.
   */
  score: number;
  /** Qloo heatmap `popularity` of the same cells (0..1): where the act's listeners are dense, in volume. */
  popularity: number;
  /** How many heatmap cells fell within range of this city. */
  cells: number;
  /** The strongest cells, kept for the map and the explanation. */
  topCells: HeatmapCell[];
  /** `score` rescaled 0..100 across the ranked candidates (min-max), so small affinity gaps read at a glance. */
  index: number;
  /** 1-based rank by `score` at the time of ranking. */
  rank: number;
  /** 1-based rank by heatmap `popularity`. */
  popularityRank: number;
  /** 1-based rank by metro population (cities.ts, public figures). */
  populationRank: number;
  /** Taste lift = populationRank - rank: positive means taste says more than size does. */
  lift: number;
  /** No heatmap cell within range: Qloo has no signal for the act around this city. */
  noSignal?: boolean;
  /** Short note shown in the grid ("no Qloo signal", country normalisation...). */
  note?: string;
  /** User (or policy) excluded this city; it stays visible but is never routed. */
  excluded?: boolean;
  excludedReason?: string;
  /** Co-bill: the same binning on a heatmap signalled by headliner + tour opener (set by pickTourOpener). */
  jointScore?: number;
  jointRank?: number;
}

export interface Partner {
  entity_id: string;
  name: string;
  affinity: number;
  popularity?: number;
  subtype?: string;
  address?: string;
  lat?: number;
  lon?: number;
  /** Venue capacity / brand category / opener genre, whichever applies. */
  detail?: string;
  capacity?: number;
  estimatedCostUsd?: number;
  explainability?: Contribution[];
  /** The promoter holds this venue (policy.heldVenues); when no Qloo venue matched the name, affinity is 0 and detail says so. */
  held?: boolean;
}

export interface CityPartners {
  city: string;
  venues: Partner[];
  brands: Partner[];
  openers: Partner[];
  /** The venue the agent recommends (first venue inside the capacity window). */
  recommendedVenue?: Partner;
  /** One-paragraph "why", written from the explainability contributions (opens with the ranking sentence). */
  why: string;
  /** The same without the ranking sentence, for explain_choice (which states the rank itself). */
  whyPartners?: string;
  mode: DataMode;
}

export interface Stop {
  order: number;
  city: string;
  country: string;
  lat: number;
  lon: number;
  date: string; // yyyy-mm-dd
  score: number;
  venue?: Partner;
  opener?: Partner;
  brand?: Partner;
  /** Distance from the previous stop in km (0 for the first). */
  legKm: number;
  /** Pinned to this date by a promoter hold (policy.heldVenues). */
  held?: boolean;
}

export interface Itinerary {
  id: string;
  act: Act;
  stops: Stop[];
  totalKm: number;
  startDate: string;
  endDate: string;
  /** Sum of estimated venue costs for the stops that have a cost figure (0 = none known; live Qloo venues carry none). */
  estimatedCostUsd: number;
  /** The start city the promoter named, if any; a counterfactual baseline must keep it too. */
  startCity?: string;
  gapDays?: number;
  builtAt: string;
  mode: DataMode;
}

/** One Qloo request made for this plan (provenance panel + share page). Entity ids are redacted to a prefix. */
export interface QlooCall {
  ts: string;
  endpoint: string;
  /** Parameter names with redacted values (entity ids -> first 8 chars, everything else verbatim). */
  params: Record<string, string>;
  /** Served from the private server-side cache. */
  cached: boolean;
  status?: number;
  ms?: number;
  /** Result count (entities or heatmap cells). */
  results?: number;
  mode: DataMode;
}

/** One act that appears in several cities' opener lists. */
export interface TourOpenerCandidate {
  entity_id: string;
  name: string;
  detail?: string;
  /** Stops where this act is in the city's top openers. */
  stopsAppeared: number;
  ofStops: number;
  meanAffinity: number;
  cities: string[];
}

/** The co-bill view: one opener for the whole run, and the markets ranked on the pairing. */
export interface CoBill {
  opener: Partner;
  stopsAppeared: number;
  ofStops: number;
  meanAffinity: number;
  /** Other acts that recur across stops, best first (the tour opener excluded). */
  alternates: TourOpenerCandidate[];
  /** Per routed city: the local #1 opener when it is not the tour opener. */
  locals: Record<string, string>;
  /** "joint": one heatmap per country signalled by both acts. "averaged": the API refused two signals, so two single-signal maps were averaged. */
  method: "joint" | "averaged";
  methodNote: string;
  /** Per candidate city: headliner-only vs joint affinity, and the rank under each. */
  cities: Array<{ city: string; headliner: number; joint: number; delta: number; headlinerRank: number; jointRank: number }>;
  computedAt: string;
  mode: DataMode;
}

export interface CompareResult {
  /** What the taste-driven itinerary was compared against. */
  against: "population" | "popularity" | "previous" | "cobill";
  label: string;
  /** Cities routed in the taste plan but not in the baseline. */
  swappedIn: Stop[];
  /** Cities in the baseline but not in the taste plan. */
  swappedOut: Stop[];
  avgAffinity: { plan: number; baseline: number; delta: number };
  /** Co-bill (headliner + tour opener) affinity of the same stops, when a tour opener has been picked. */
  avgJointAffinity?: { plan: number; baseline: number; delta: number };
  totalKm: { plan: number; baseline: number; delta: number };
  estimatedCostUsd: { plan: number; baseline: number; delta: number };
  /** Openers / brands that only the taste plan carries, and ones only the baseline carries. */
  openers: { gained: string[]; lost: string[] };
  brands: { gained: string[]; lost: string[] };
  baseline: Itinerary;
  computedAt: string;
}

export interface Plan {
  act?: Act;
  region?: Region[];
  candidates: RankedCity[];
  partners: Record<string, CityPartners>;
  itinerary?: Itinerary;
  /** The itinerary before the last rebuild (for compare_plans "previous"). */
  previousItinerary?: Itinerary;
  /** Last counterfactual comparison (population / popularity baseline or the previous itinerary). */
  compare?: CompareResult;
  /** Tour opener + co-bill markets (pickTourOpener). */
  coBill?: CoBill;
  /** Qloo requests behind this plan, newest last (capped). */
  calls: QlooCall[];
  /** The last Qloo failure; shown as a banner. Nothing is ever substituted for a failed call. */
  lastError?: { ts: string; message: string; status?: number; tool?: string };
  mode: DataMode;
}

export function emptyPlan(mode: DataMode): Plan {
  return { candidates: [], partners: {}, calls: [], mode };
}

const firstString = (...vals: unknown[]): string | undefined => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v;
    if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0];
    if (v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string") return (v as { name: string }).name;
  }
  return undefined;
};

/** Flatten a Qloo entity into what the cards and exports show. Field names follow the live API (verified 2026-10-13). */
export function partnerFromEntity(e: InsightEntity, labels: Record<string, string> = {}): Partner {
  const p = e.properties;
  const capacity = typeof p.capacity === "number" ? p.capacity : undefined;
  const cost = typeof p.estimated_rent_usd === "number" ? p.estimated_rent_usd : undefined;
  const rating = typeof p.business_rating === "number" ? ` ${p.business_rating.toFixed(1)}*` : "";
  const detail =
    e.type === "urn:entity:place"
      ? (capacity ? `capacity ${capacity.toLocaleString("en-US")}` : (firstString(p.primary_genre, e.subtype?.split(":").at(-1)?.replaceAll("_", " ")) ?? "venue")) + rating
      : e.type === "urn:entity:brand"
        ? (firstString(p.category, p.industries, p.brand_type, e.tags[0]?.split(":").at(-1)) ?? "brand")
        : e.type === "urn:entity:person"
          ? (e.tags.find((t) => /stand[- _]?up|comedian/i.test(t)) ?? firstString(p.short_description) ?? "person")
          : (firstString(p.genre, p.primary_genres, e.tags[0]?.split(":").at(-1)) ?? "artist");
  const explainability = e.explainability?.map((c) => ({ ...c, label: c.label ?? labels[c.signal] }));
  return { entity_id: e.entity_id, name: e.name, affinity: e.affinity, popularity: e.popularity, subtype: e.subtype, address: e.address, lat: e.geo?.latitude, lon: e.geo?.longitude, detail, capacity, estimatedCostUsd: cost, explainability };
}
