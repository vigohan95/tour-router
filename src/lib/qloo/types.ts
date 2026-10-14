/**
 * Typed subset of the Qloo Insights API (https://docs.qloo.com) that Tour Router uses.
 *
 * Only the fields the product reads are typed; everything else stays in `raw` so a live response
 * can be inspected without a schema fight. Shapes were verified against the hackathon API on 2026-10-13
 * (see docs/LIVE-NOTES.md) for:
 *   GET /search                       name -> entity ids (types=urn:entity:artist,urn:entity:person)
 *   GET /v2/insights                  filter.type=urn:entity:{artist|place|brand|person} (+ filter.location / signal.location, signals)
 *   GET /v2/insights                  filter.type=urn:heatmap (+ filter.location.query=<country or city>)
 *   feature.explainability=true       per-result contribution of each input signal
 */

export type EntityType = "urn:entity:artist" | "urn:entity:place" | "urn:entity:brand" | "urn:entity:person";

export const ENTITY_TYPES: EntityType[] = ["urn:entity:artist", "urn:entity:place", "urn:entity:brand", "urn:entity:person"];

export interface SearchHit {
  entity_id: string;
  name: string;
  types: string[];
  /** 0..1 as returned by Qloo (higher = more popular). */
  popularity?: number;
  /** Short description or the first tag names; live `disambiguation` is just the name again, so it is not used. */
  hint?: string;
  /** Tag ids on the hit (live: `tags[].id`); used to tell comedians (person entities) from musicians. */
  tagIds?: string[];
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
  /** Contribution score; Qloo reports these relative to the result's affinity (one signal = 1.0). */
  score: number;
}

export interface InsightEntity {
  entity_id: string;
  name: string;
  type: EntityType;
  /** Live: `properties.primary_genre.id` for places (e.g. urn:tag:genre:place:live_music_venue); fixtures: a synthetic subtype. */
  subtype?: string;
  /** Affinity of this entity with the input signals, 0..1 (live: `query.affinity`). */
  affinity: number;
  popularity?: number;
  geo?: Geo;
  address?: string;
  /** Free-form properties (website, phone, business_rating, description...). Live places carry NO capacity or cost. */
  properties: Record<string, unknown>;
  /** Tag names (live: `tags[].name`). */
  tags: string[];
  /** Present only when feature.explainability=true was requested. */
  explainability?: Contribution[];
  raw?: unknown;
}

export interface InsightsParams {
  type: EntityType;
  /** signal.interests.entities */
  signalEntities: string[];
  /**
   * filter.location.query (a city name) or filter.location (lat,lon). Live: only honoured for urn:entity:place;
   * for artists/brands/persons Qloo ignores it (use `signalLocation`).
   */
  location?: { query: string } | ({ radiusKm?: number } & Geo);
  /** signal.location.query: weights results by how much this locality's population over-indexes on them. */
  signalLocation?: { query: string };
  /** filter.tags (comma-joined; live treats the list as a union) */
  tags?: string[];
  take?: number;
  explainability?: boolean;
  /** bias.trends: "off" | "low" | "medium" | "high" */
  trends?: "off" | "low" | "medium" | "high";
  /** filter.exclude.entities (e.g. the headliner itself when asking for openers). */
  excludeEntities?: string[];
  /** filter.results.entities: restrict the results to these ids ("how does <locality> feel about <act>"). */
  resultEntities?: string[];
}

export interface InsightsResult {
  entities: InsightEntity[];
  /** Qloo echoes the resolved query; kept for the "request-to-result" explanation. */
  query?: unknown;
  raw?: unknown;
}

export interface HeatmapParams {
  signalEntities: string[];
  /** filter.location.query (a country or city name) or filter.location (point + radius). */
  location: { query: string } | ({ radiusKm?: number } & Geo);
  /** Ignored by the live API for heatmaps (every cell comes back); honoured by the fixture. */
  take?: number;
}

export interface HeatmapCell extends Geo {
  geohash?: string;
  /** 0..1 affinity of this cell's population with the signal, min-max normalised INSIDE the queried area. */
  affinity: number;
  /** 0..1 rank within the heatmap (1 = strongest). */
  affinity_rank?: number;
  popularity?: number;
}

export interface HeatmapResult {
  cells: HeatmapCell[];
  raw?: unknown;
}

/**
 * `filter.type=urn:demographics` (verified 2026-10-13): `results.demographics[0].query.{age, gender}`, each bucket an
 * over/under-index from -1 to 1 for the signal entity. Not a share of the audience and not a count.
 */
export interface DemographicsResult {
  /** e.g. 24_and_younger, 25_to_29, 30_to_34, 35_to_44, 45_to_54, 55_and_older */
  age: Record<string, number>;
  /** male, female */
  gender: Record<string, number>;
  raw?: unknown;
}

/** Where a value came from. The UI shows this on every card so judges never mistake fixtures for live data. */
export type DataMode = "fixture" | "live";

export interface QlooAdapter {
  readonly mode: DataMode;
  search(query: string, types?: EntityType[], take?: number): Promise<SearchHit[]>;
  insights(params: InsightsParams): Promise<InsightsResult>;
  heatmap(params: HeatmapParams): Promise<HeatmapResult>;
  /** urn:demographics for the signal entities (optional: test doubles may omit it; the audience card is then skipped). */
  demographics?(signalEntities: string[]): Promise<DemographicsResult>;
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
