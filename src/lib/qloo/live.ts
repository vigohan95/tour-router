/**
 * Live Qloo client for the hackathon API (https://hackathon.api.qloo.com).
 *
 * - GET only, `X-Api-Key` header, query-string parameters exactly as documented.
 * - Private in-memory cache keyed by the full URL (the rules allow private server-side caching; nothing
 *   is written to disk or to the repository).
 * - A small concurrency limiter so ranking 40+ cities does not fire 40 requests at once.
 * - Errors surface as QlooError with status + body; nothing is retried silently and nothing is invented.
 */
import { reportCall } from "./calls";
import { ENTITY_TYPES, QlooError, type Contribution, type DemographicsResult, type EntityType, type HeatmapCell, type HeatmapParams, type HeatmapResult, type InsightEntity, type InsightsParams, type InsightsResult, type QlooAdapter, type SearchHit } from "./types";

type J = Record<string, unknown>;
const j = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export interface LiveOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Max in-flight requests (default 2). */
  concurrency?: number;
  /** Minimum ms between request starts (default 350). The hackathon key rate-limits bursts: 429s were observed at ~30 rapid calls. */
  minIntervalMs?: number;
  /** Retries on 429 / 5xx with exponential backoff (default 3), honouring Retry-After when sent. */
  maxRetries?: number;
  /** First backoff wait in ms (default 1500; doubles per attempt). */
  backoffMs?: number;
  /** Cache TTL in ms; the hackathon key has no time limit on caching, default 7 days. */
  cacheTtlMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  at: number;
  value: unknown;
}

class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/* ---------------- response parsing (tolerant: Qloo adds fields over time) ---------------- */

function parseContributions(v: unknown): Contribution[] | undefined {
  // Documented shape: query.explainability.signal.interests.entities = { "<entity_id>": score, ... }
  // Older/alt shape: an array of { entity_id, score }. Both are accepted.
  const ex = j(j(v).explainability);
  const sig = j(ex.signal);
  const out: Contribution[] = [];
  const push = (bucket: unknown, prefix: string) => {
    if (Array.isArray(bucket)) {
      for (const it of bucket) {
        const o = j(it);
        const id = str(o.entity_id) ?? str(o.id) ?? str(o.tag_id);
        const score = num(o.score);
        if (id && score !== undefined) out.push({ signal: id, label: str(o.name), score });
      }
    } else {
      for (const [k, s] of Object.entries(j(bucket))) {
        const score = num(s) ?? num(j(s).score);
        if (score !== undefined) out.push({ signal: k.startsWith("urn:") || prefix === "" ? k : `${prefix}:${k}`, label: str(j(s).name), score });
      }
    }
  };
  const interests = j(sig.interests);
  push(interests.entities, "");
  push(interests.tags, "");
  push(sig.demographics, "demographics");
  // Live hackathon API (verified 2026-10-13): flat keys on the entity, e.g.
  //   query.explainability["signal.interests.entities"] = [{ entity_id, score }]
  for (const [k, bucket] of Object.entries(ex)) if (k.startsWith("signal.")) push(bucket, k.startsWith("signal.demographics") ? "demographics" : "");
  if (out.length === 0 && Object.keys(ex).length === 0) return undefined;
  return out;
}

export function parseEntity(raw: unknown, fallbackType: EntityType): InsightEntity {
  const o = j(raw);
  const props = j(o.properties);
  const geocode = j(props.geocode);
  const lat = num(o.latitude) ?? num(props.latitude) ?? num(geocode.latitude) ?? num(j(o.location).lat);
  const lon = num(o.longitude) ?? num(props.longitude) ?? num(geocode.longitude) ?? num(j(o.location).lon);
  const query = j(o.query);
  const types = arr(o.types).map(String);
  const type = (ENTITY_TYPES.find((t) => types.includes(t) || str(o.type) === t) ?? fallbackType) as EntityType;
  const tags = arr(o.tags)
    .map((t) => str(j(t).name) ?? str(j(t).id) ?? str(t))
    .filter((t): t is string => !!t);
  return {
    entity_id: str(o.entity_id) ?? str(o.id) ?? "",
    name: str(o.name) ?? "",
    type,
    // Live entities say type="urn:entity", subtype="urn:entity:place"; the useful subtype for places is properties.primary_genre.id.
    subtype: str(j(props.primary_genre).id) ?? str(o.subtype) ?? types.find((t) => t !== type),
    affinity: num(query.affinity) ?? num(o.affinity) ?? 0,
    popularity: num(o.popularity),
    geo: lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : undefined,
    address: str(props.address) ?? str(j(props.address).formatted),
    properties: props,
    tags,
    explainability: parseContributions(query),
    raw,
  };
}

export function parseSearchHit(raw: unknown): SearchHit {
  const o = j(raw);
  const props = j(o.properties);
  return {
    entity_id: str(o.entity_id) ?? str(o.id) ?? "",
    name: str(o.name) ?? "",
    types: arr(o.types).map(String),
    popularity: num(o.popularity),
    // Live: `disambiguation` repeats the name, so the short description or the first tag names serve as the hint.
    hint: str(props.short_description)?.slice(0, 120) ?? (arr(o.tags).map((t) => str(j(t).name)).filter(Boolean).slice(0, 3).join(", ") || undefined),
    // /search tags carry `id` or `tag_id` (and always `name`); keep whichever exists so comedians can be told from musicians.
    tagIds: arr(o.tags).map((t) => str(j(t).id) ?? str(j(t).tag_id) ?? str(j(t).name)).filter((t): t is string => !!t),
    raw,
  };
}

export function parseHeatmapCell(raw: unknown): HeatmapCell | undefined {
  const o = j(raw);
  const loc = j(o.location);
  const q = j(o.query);
  const lat = num(loc.latitude) ?? num(o.latitude);
  const lon = num(loc.longitude) ?? num(o.longitude);
  const affinity = num(q.affinity) ?? num(o.affinity);
  if (lat === undefined || lon === undefined || affinity === undefined) return undefined;
  return { latitude: lat, longitude: lon, geohash: str(loc.geohash), affinity, affinity_rank: num(q.affinity_rank), popularity: num(q.popularity) };
}

/** `results.demographics[0].query.{age,gender}`; buckets are numbers in -1..1 (anything else is dropped). */
export function parseDemographics(body: unknown): DemographicsResult {
  const first = j(arr(j(j(body).results).demographics)[0]);
  const query = j(first.query);
  const bucket = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, x] of Object.entries(j(v))) {
      const n = num(x);
      if (n !== undefined) out[k] = n;
    }
    return out;
  };
  return { age: bucket(query.age), gender: bucket(query.gender), raw: body };
}

/* ---------------- query building ---------------- */

function locationParams(loc: InsightsParams["location"]): Record<string, string> {
  if (!loc) return {};
  if ("query" in loc) return { "filter.location.query": loc.query };
  const out: Record<string, string> = { "filter.location": `POINT(${loc.longitude} ${loc.latitude})` };
  if (loc.radiusKm) out["filter.location.radius"] = String(Math.round(loc.radiusKm * 1000));
  return out;
}

export function insightsQuery(p: InsightsParams): Record<string, string> {
  // Qloo rejects take outside 1..50 on entity insights.
  const take = Math.min(50, Math.max(1, Math.round(p.take ?? 10)));
  const q: Record<string, string> = { "filter.type": p.type, take: String(take), ...locationParams(p.location) };
  if (p.signalEntities.length) q["signal.interests.entities"] = p.signalEntities.join(",");
  if (p.signalLocation) q["signal.location.query"] = p.signalLocation.query;
  if (p.resultEntities?.length) q["filter.results.entities"] = p.resultEntities.join(",");
  if (p.tags?.length) q["filter.tags"] = p.tags.join(",");
  if (p.explainability) q["feature.explainability"] = "true";
  if (p.trends) q["bias.trends"] = p.trends;
  if (p.excludeEntities?.length) q["filter.exclude.entities"] = p.excludeEntities.join(",");
  return q;
}

export function heatmapQuery(p: HeatmapParams): Record<string, string> {
  return { "filter.type": "urn:heatmap", "signal.interests.entities": p.signalEntities.join(","), take: String(p.take ?? 50), ...locationParams(p.location) };
}

export class LiveQloo implements QlooAdapter {
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly limiter: Limiter;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minInterval: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private nextSlot = 0;
  /** Counters for the UI / tests: how many requests went to the network vs. the cache, and how many were retried. */
  readonly stats = { requests: 0, cacheHits: 0, errors: 0, retries: 0 };

  constructor(private readonly opts: LiveOptions) {
    if (!opts.apiKey) throw new Error("LiveQloo needs an apiKey (QLOO_API_KEY)");
    this.baseUrl = (opts.baseUrl ?? "https://hackathon.api.qloo.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.limiter = new Limiter(opts.concurrency ?? 2);
    this.ttl = opts.cacheTtlMs ?? 7 * 24 * 3600_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minInterval = opts.minIntervalMs ?? 350;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffMs = opts.backoffMs ?? 1500;
  }

  /** Space request starts by minInterval so a 40-city ranking never bursts past the key's rate limit. */
  private async pace() {
    if (this.minInterval <= 0) return;
    const now = this.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.minInterval;
    if (at > now) await this.sleep(at - now);
  }

  url(path: string, params: Record<string, string>): string {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) if (v !== "") u.searchParams.set(k, v);
    return u.toString();
  }

  async get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = this.url(path, params);
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < this.ttl) {
      this.stats.cacheHits++;
      reportCall({ endpoint: path, params, cached: true, results: countResults(hit.value), mode: "live" });
      return hit.value;
    }
    const t0 = this.now();
    return this.limiter.run(async () => {
      for (let attempt = 0; ; attempt++) {
        await this.pace();
        this.stats.requests++;
        let res: Response;
        try {
          res = await this.fetchImpl(url, { headers: { "X-Api-Key": this.opts.apiKey, accept: "application/json" } });
        } catch (e) {
          this.stats.errors++;
          throw new QlooError(`Qloo request failed: ${e instanceof Error ? e.message : String(e)}`, 0, redact(url));
        }
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoffMs * 2 ** attempt;
          this.stats.retries++;
          await this.sleep(wait);
          continue;
        }
        if (!res.ok) {
          this.stats.errors++;
          throw new QlooError(`Qloo ${res.status} on ${path}: ${text.slice(0, 200)}`, res.status, redact(url), text);
        }
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          this.stats.errors++;
          throw new QlooError(`Qloo returned non-JSON on ${path}`, res.status, redact(url), text);
        }
        this.cache.set(url, { at: this.now(), value: body });
        reportCall({ endpoint: path, params, cached: false, status: res.status, ms: this.now() - t0, results: countResults(body), mode: "live" });
        return body;
      }
    });
  }

  async search(query: string, types: EntityType[] = ["urn:entity:artist"], take = 8): Promise<SearchHit[]> {
    const body = j(await this.get("/search", { query, types: types.join(","), take: String(take) }));
    return arr(body.results).map(parseSearchHit).filter((h) => h.entity_id && h.name);
  }

  async insights(p: InsightsParams): Promise<InsightsResult> {
    const body = j(await this.get("/v2/insights", insightsQuery(p)));
    const results = j(body.results);
    const entities = arr(results.entities).map((e) => parseEntity(e, p.type)).filter((e) => e.entity_id);
    return { entities, query: body.query, raw: body };
  }

  async heatmap(p: HeatmapParams): Promise<HeatmapResult> {
    const body = j(await this.get("/v2/insights", heatmapQuery(p)));
    const results = j(body.results);
    const cells = arr(results.heatmap).map(parseHeatmapCell).filter((c): c is HeatmapCell => !!c);
    return { cells, raw: body };
  }

  async demographics(signalEntities: string[]): Promise<DemographicsResult> {
    const body = await this.get("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": signalEntities.join(",") });
    return parseDemographics(body);
  }

  clearCache() {
    this.cache.clear();
  }
}

function countResults(body: unknown): number | undefined {
  const r = j(body).results;
  if (Array.isArray(r)) return r.length;
  const o = j(r);
  return arr(o.entities).length || arr(o.heatmap).length || arr(o.tags).length || undefined;
}

/** Never let the key leak through an error message or a log line. */
function redact(url: string): string {
  return url.replace(/([?&](?:api_key|key)=)[^&]+/gi, "$1***");
}
