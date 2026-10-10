/**
 * The tour plan the agent builds up. This is what the UI renders and what the browser carries as a snapshot.
 */
import type { Contribution, DataMode, HeatmapCell, InsightEntity } from "../qloo/types";
import type { Region } from "./cities";

export interface Act {
  entity_id: string;
  name: string;
  hint?: string;
  popularity?: number;
}

export interface RankedCity {
  city: string;
  country: string;
  region: Region;
  lat: number;
  lon: number;
  /** Aggregated affinity 0..1 (mean of the top heatmap cells). */
  score: number;
  /** How many heatmap cells backed the score. */
  cells: number;
  /** The strongest cells, kept for the map. */
  topCells: HeatmapCell[];
  /** 1-based rank at the time of ranking. */
  rank: number;
  /** User (or policy) excluded this city; it stays visible but is never routed. */
  excluded?: boolean;
  excludedReason?: string;
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
}

export interface CityPartners {
  city: string;
  venues: Partner[];
  brands: Partner[];
  openers: Partner[];
  /** The venue the agent recommends (first venue inside the capacity window). */
  recommendedVenue?: Partner;
  /** One-paragraph "why", written from the explainability contributions. */
  why: string;
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
}

export interface Itinerary {
  id: string;
  act: Act;
  stops: Stop[];
  totalKm: number;
  startDate: string;
  endDate: string;
  /** Sum of estimated venue costs for the stops that have a venue. */
  estimatedCostUsd: number;
  builtAt: string;
  mode: DataMode;
}

export interface Plan {
  act?: Act;
  region?: Region[];
  candidates: RankedCity[];
  partners: Record<string, CityPartners>;
  itinerary?: Itinerary;
  mode: DataMode;
}

export function emptyPlan(mode: DataMode): Plan {
  return { candidates: [], partners: {}, mode };
}

export function partnerFromEntity(e: InsightEntity): Partner {
  const capacity = typeof e.properties.capacity === "number" ? e.properties.capacity : undefined;
  const cost = typeof e.properties.estimated_rent_usd === "number" ? e.properties.estimated_rent_usd : undefined;
  const detail =
    e.type === "urn:entity:place"
      ? capacity
        ? `capacity ${capacity.toLocaleString("en-US")}`
        : e.subtype?.split(":").at(-1)?.replaceAll("_", " ")
      : e.type === "urn:entity:brand"
        ? String(e.properties.category ?? e.tags[0]?.split(":").at(-1) ?? "brand")
        : String(e.properties.genre ?? e.tags[0]?.split(":").at(-1) ?? "artist");
  return { entity_id: e.entity_id, name: e.name, affinity: e.affinity, popularity: e.popularity, subtype: e.subtype, address: e.address, lat: e.geo?.latitude, lon: e.geo?.longitude, detail, capacity, estimatedCostUsd: cost, explainability: e.explainability };
}
