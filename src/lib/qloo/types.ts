/**
 * Typed subset of the Qloo Insights API (https://docs.qloo.com) that Tour Router uses.
 *
 * Only the fields the product reads are typed; everything else stays in `raw` so a live response
 * can be inspected without a schema fight. Shapes follow the public docs for:
 *   GET /search                       name -> entity ids
 *   GET /v2/insights                  filter.type=urn:entity:{artist|place|brand} (+ filter.location, signals)
 *   GET /v2/insights                  filter.type=urn:heatmap (+ filter.location)
 *   feature.explainability=true       per-result contribution of each input signal
 */

export type EntityType = "urn:entity:artist" | "urn:entity:place" | "urn:entity:brand";

export const ENTITY_TYPES: EntityType[] = ["urn:entity:artist", "urn:entity:place", "urn:entity:brand"];

export interface SearchHit {
  entity_id: string;
  name: string;
  types: string[];
  /** 0..1 as returned by Qloo (higher = more popular). */
  popularity?: number;
  /** Qloo "disambiguation" hints, e.g. genre tags or a short description. */
  hint?: string;
  raw?: unknown;
}

export interface Geo {
  latitude: number;
  longitude: number;
}

/** One contribution to a result's affinity, as reported by feature.explainability. */
export interface Contribution {
  /** The input signal this score belongs to (an entity id, a tag id or a demographic bucket). */
  signal: string;
  /** Human label for the signal when known (e.g. the artist's name). */
  label?: string;
  /** Contribution score; Qloo reports these relative to the result's affinity. */
  score: number;
}

export interface InsightEntity {
  entity_id: string;
  name: string;
  type: EntityType;
  /** Qloo subtype, e.g. urn:entity:place:venue or urn:tag:genre:music:indie for tags. */
  subtype?: string;
  /** Affinity of this entity with the input signals, 0..1. */
  affinity: number;
  popularity?: number;
  geo?: Geo;
  address?: string;
  /** Free-form properties (website, phone, business rating, capacity when present, description...). */
  properties: Record<string, unknown>;
  tags: string[];
  /** Present only when feature.explainability=true was requested. */
  explainability?: Contribution[];
  raw?: unknown;
}

export interface InsightsParams {
  type: EntityType;
  /** signal.interests.entities */
  signalEntities: string[];
  /** filter.location.query (a city name) or filter.location (lat,lon). */
  location?: { query: string } | ({ radiusKm?: number } & Geo);
  /** filter.tags, e.g. urn:tag:genre:place:music_venue */
  tags?: string[];
  take?: number;
  explainability?: boolean;
  /** bias.trends: "low" | "medium" | "high" */
  trends?: "low" | "medium" | "high";
  /** filter.exclude.entities (e.g. the headliner itself when asking for openers). */
  excludeEntities?: string[];
}

export interface InsightsResult {
  entities: InsightEntity[];
  /** Qloo echoes the resolved query; kept for the "request-to-result" explanation. */
  query?: unknown;
  raw?: unknown;
}

export interface HeatmapParams {
  signalEntities: string[];
  location: { query: string } | ({ radiusKm?: number } & Geo);
  take?: number;
}

export interface HeatmapCell extends Geo {
  geohash?: string;
  /** 0..1 affinity of this cell's population with the signal. */
  affinity: number;
  /** 0..1 rank within the heatmap (1 = strongest). */
  affinity_rank?: number;
  popularity?: number;
}

export interface HeatmapResult {
  cells: HeatmapCell[];
  raw?: unknown;
}

/** Where a value came from. The UI shows this on every card so judges never mistake fixtures for live data. */
export type DataMode = "fixture" | "live";

export interface QlooAdapter {
  readonly mode: DataMode;
  search(query: string, types?: EntityType[], take?: number): Promise<SearchHit[]>;
  insights(params: InsightsParams): Promise<InsightsResult>;
  heatmap(params: HeatmapParams): Promise<HeatmapResult>;
}

export class QlooError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "QlooError";
  }
}
