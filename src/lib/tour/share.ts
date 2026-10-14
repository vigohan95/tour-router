/**
 * Shareable read-only tour page: the plan is compressed into the URL (`/t/<payload>`, lz-string), so a judge
 * opens a finished plan with no agent run, no LLM quota and no server state.
 *
 * The payload carries names, scores and labels only: no Qloo entity ids, no raw responses, no audit inputs.
 */
// Default import: lz-string ships a UMD build; the named-import interop differs between vitest and the Next server bundle.
import LZString from "lz-string";

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = LZString;
import type { AuditEntry } from "../store";
import type { Policy } from "../policy/schema";
import type { CompareResult, DataModeLike, Partner, Plan, QlooCall } from "./types";

export const SHARE_VERSION = 1;

export interface SharedPartner {
  name: string;
  detail?: string;
  affinity: number;
  capacity?: number;
  explain?: Array<{ label: string; score: number }>;
  held?: boolean;
}

export interface SharedStop {
  order: number;
  city: string;
  country: string;
  lat: number;
  lon: number;
  date: string;
  score: number;
  lift?: number;
  rank?: number;
  populationRank?: number;
  legKm: number;
  held?: boolean;
  /** Co-bill affinity (headliner + tour opener joint heatmap), when a tour opener was picked. */
  joint?: number;
  venue?: SharedPartner;
  opener?: SharedPartner;
  brand?: SharedPartner;
  why?: string;
}

export interface SharedCandidate {
  city: string;
  country: string;
  score: number;
  popularity: number;
  rank: number;
  popularityRank: number;
  populationRank: number;
  lift: number;
  excluded?: boolean;
  noSignal?: boolean;
}

export interface SharedCompare {
  against: CompareResult["against"];
  label: string;
  swappedIn: string[];
  swappedOut: string[];
  avgAffinity: CompareResult["avgAffinity"];
  totalKm: CompareResult["totalKm"];
  openers: CompareResult["openers"];
  brands: CompareResult["brands"];
  baselineStops: Array<{ order: number; city: string; score: number }>;
}

export interface SharePayload {
  v: number;
  act: { name: string; kind?: "artist" | "person"; hint?: string };
  mode: DataModeLike;
  generatedAt: string;
  title: string;
  startDate: string;
  endDate: string;
  totalKm: number;
  estimatedCostUsd: number;
  stops: SharedStop[];
  candidates: SharedCandidate[];
  compare?: SharedCompare;
  cobill?: { opener: string; detail?: string; stopsAppeared: number; ofStops: number; meanAffinity: number; method: "joint" | "averaged"; note: string; locals: Record<string, string> };
  policy: { maxCities: number; budgetPerCity: number; regions: string[]; excludeCities: string[]; venue: { minCapacity: number; maxCapacity: number }; minGapDays: number; blackoutDates?: string[]; heldVenues?: Array<{ city: string; venue: string; date: string }>; minKmBetweenStops?: number; maxKmPerLeg?: number };
  audit: { allowed: number; approved: number; denied: number; approvalRequired: number; errors: number; lines: string[] };
  qloo: { calls: number; cached: number; endpoints: Array<{ endpoint: string; type: string; n: number }> };
}

const partner = (p?: Partner): SharedPartner | undefined =>
  p
    ? {
        name: p.name,
        detail: p.detail,
        affinity: p.affinity,
        capacity: p.capacity,
        held: p.held || undefined,
        explain: p.explainability
          ?.slice()
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((c) => ({ label: c.label ?? c.signal.split(":").at(-1) ?? "signal", score: c.score })),
      }
    : undefined;

/** Build the payload from the studio state. Pure. */
export function buildSharePayload(plan: Plan, policy: Policy, audit: AuditEntry[], now = new Date()): SharePayload {
  const it = plan.itinerary;
  if (!it) throw new Error("Build an itinerary before sharing.");
  const ranked = new Map(plan.candidates.map((c) => [c.city, c]));
  const stops: SharedStop[] = it.stops.map((s) => {
    const r = ranked.get(s.city);
    return { order: s.order, city: s.city, country: s.country, lat: s.lat, lon: s.lon, date: s.date, score: s.score, lift: r?.lift, rank: r?.rank, populationRank: r?.populationRank, legKm: s.legKm, held: s.held || undefined, joint: r?.jointScore, venue: partner(s.venue), opener: partner(s.opener), brand: partner(s.brand), why: plan.partners[s.city]?.why };
  });
  const candidates: SharedCandidate[] = plan.candidates.slice(0, 40).map((c) => ({ city: c.city, country: c.country, score: c.score, popularity: c.popularity, rank: c.rank, popularityRank: c.popularityRank, populationRank: c.populationRank, lift: c.lift, excluded: c.excluded, noSignal: c.noSignal }));
  const cmp = plan.compare;
  const compare: SharedCompare | undefined = cmp
    ? { against: cmp.against, label: cmp.label, swappedIn: cmp.swappedIn.map((s) => s.city), swappedOut: cmp.swappedOut.map((s) => s.city), avgAffinity: cmp.avgAffinity, totalKm: cmp.totalKm, openers: cmp.openers, brands: cmp.brands, baselineStops: cmp.baseline.stops.map((s) => ({ order: s.order, city: s.city, score: s.score })) }
    : undefined;
  const count = (d: AuditEntry["decision"]) => audit.filter((a) => a.decision === d).length;
  const endpoints = new Map<string, { endpoint: string; type: string; n: number }>();
  for (const c of plan.calls) {
    const type = c.params["filter.type"] ?? "";
    const key = `${c.endpoint}|${type}`;
    const e = endpoints.get(key) ?? { endpoint: c.endpoint, type, n: 0 };
    e.n++;
    endpoints.set(key, e);
  }
  return {
    v: SHARE_VERSION,
    act: { name: it.act.name, kind: it.act.kind, hint: it.act.hint },
    mode: it.mode,
    generatedAt: now.toISOString(),
    title: `${it.act.name} - ${it.stops.length}-stop tour`,
    startDate: it.startDate,
    endDate: it.endDate,
    totalKm: it.totalKm,
    estimatedCostUsd: it.estimatedCostUsd,
    stops,
    candidates,
    compare,
    cobill: plan.coBill ? { opener: plan.coBill.opener.name, detail: plan.coBill.opener.detail, stopsAppeared: plan.coBill.stopsAppeared, ofStops: plan.coBill.ofStops, meanAffinity: plan.coBill.meanAffinity, method: plan.coBill.method, note: plan.coBill.methodNote, locals: plan.coBill.locals } : undefined,
    policy: { maxCities: policy.maxCities, budgetPerCity: policy.budgetPerCity, regions: policy.regions, excludeCities: policy.excludeCities, venue: policy.venue, minGapDays: policy.minGapDays, blackoutDates: policy.blackoutDates, heldVenues: policy.heldVenues, minKmBetweenStops: policy.minKmBetweenStops, maxKmPerLeg: policy.maxKmPerLeg },
    audit: {
      allowed: count("allowed"),
      approved: count("approved"),
      denied: count("denied"),
      approvalRequired: count("approval-required"),
      errors: count("error"),
      lines: audit
        .filter((a) => a.decision !== "info")
        .slice(0, 12)
        .map((a) => `${a.decision}: ${a.action}${a.rule ? ` [${a.rule}]` : ""}`),
    },
    qloo: { calls: plan.calls.length, cached: plan.calls.filter((c) => c.cached).length, endpoints: [...endpoints.values()] },
  };
}

export function encodeShare(payload: SharePayload): string {
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function decodeShare(encoded: string): SharePayload | undefined {
  try {
    // Next hands route params to the page still percent-encoded in places (`$` -> `%24`); the lz alphabet has no `%`, so decoding is safe.
    const json = decompressFromEncodedURIComponent(safeDecode(encoded));
    if (!json) return undefined;
    const p = JSON.parse(json) as SharePayload;
    if (!p || typeof p !== "object" || p.v !== SHARE_VERSION || !Array.isArray(p.stops) || !p.act?.name) return undefined;
    return p;
  } catch {
    return undefined;
  }
}

export function sharePath(payload: SharePayload): string {
  return `/t/${encodeShare(payload)}`;
}

/** Summary of the Qloo calls for the provenance panel, grouped by endpoint + filter.type. */
export function summarizeCalls(calls: QlooCall[]): Array<{ endpoint: string; type: string; params: string[]; n: number; cached: number }> {
  const out = new Map<string, { endpoint: string; type: string; params: Set<string>; n: number; cached: number }>();
  for (const c of calls) {
    const type = c.params["filter.type"] ?? "";
    const key = `${c.endpoint}|${type}`;
    const e = out.get(key) ?? { endpoint: c.endpoint, type, params: new Set<string>(), n: 0, cached: 0 };
    for (const k of Object.keys(c.params)) if (k !== "filter.type") e.params.add(k);
    e.n++;
    if (c.cached) e.cached++;
    out.set(key, e);
  }
  return [...out.values()].map((e) => ({ ...e, params: [...e.params].sort() }));
}
