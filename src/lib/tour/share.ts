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

/** v2 adds the full policy snapshot and structured audit lines; v1 links (names + scores) still open. */
export const SHARE_VERSION = 2;
export const SHARE_VERSIONS_ACCEPTED = [1, 2];
/** Keep the path under this many characters (lz-string, URL-safe); comfortably inside every browser's limit and most chat clients' link handling. */
export const MAX_SHARE_PATH = 7_500;
/** Newest audit lines carried on the share page before the budget starts trimming. */
export const SHARE_AUDIT_LINES = 30;

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
  /** Policy counterfactual: the one changed field and the decisions that flip. */
  policy?: { label: string; flips: string[] };
}

export interface SharedAuditLine {
  /** HH:MM UTC */
  t: string;
  actor: AuditEntry["actor"];
  decision: AuditEntry["decision"];
  action: string;
  rule?: string;
  reason?: string;
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
  /** Qloo demographics for the act: one sentence (over/under-index, not shares). */
  audience?: string;
  cobill?: { opener: string; detail?: string; stopsAppeared: number; ofStops: number; meanAffinity: number; method: "joint" | "averaged"; note: string; locals: Record<string, string> };
  policy: { maxCities: number; budgetPerCity: number; regions: string[]; excludeCities: string[]; venue: { minCapacity: number; maxCapacity: number }; minGapDays: number; blackoutDates?: string[]; heldVenues?: Array<{ city: string; venue: string; date: string }>; minKmBetweenStops?: number; maxKmPerLeg?: number; approvals?: { itinerary: "auto" | "ask"; alwaysAsk: string[]; neverAllow: string[] } };
  audit: {
    allowed: number;
    approved: number;
    denied: number;
    approvalRequired: number;
    errors: number;
    /** v1: formatted strings. */
    lines: string[];
    /** v2: the newest entries, structured, newest first. */
    entries?: SharedAuditLine[];
    /** Total entries in the session's audit log (so the reader knows how much was left out). */
    total?: number;
    /** Set when the URL budget trimmed the log ("showing the last 15 of 212 entries"). */
    note?: string;
  };
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

const auditLine = (a: AuditEntry, withReason: boolean): SharedAuditLine => ({ t: a.ts.slice(11, 16), actor: a.actor, decision: a.decision, action: a.action.slice(0, 90), rule: a.rule, reason: withReason && a.reason ? a.reason.slice(0, 140) : undefined });

/**
 * Build the payload from the studio state. Pure. The policy snapshot is the whole policy; the audit log is the
 * newest SHARE_AUDIT_LINES entries, trimmed further (then the candidate table) until the encoded path fits
 * MAX_SHARE_PATH, with a note saying what was left out.
 */
export function buildSharePayload(plan: Plan, policy: Policy, audit: AuditEntry[], now = new Date()): SharePayload {
  const full = buildSharePayloadUnbounded(plan, policy, audit, now);
  const decisions = audit.filter((a) => a.decision !== "info");
  const steps: Array<{ lines: number; reasons: boolean; candidates: number }> = [
    { lines: SHARE_AUDIT_LINES, reasons: true, candidates: 40 },
    { lines: SHARE_AUDIT_LINES, reasons: false, candidates: 40 },
    { lines: 15, reasons: false, candidates: 30 },
    { lines: 8, reasons: false, candidates: 20 },
    { lines: 4, reasons: false, candidates: 12 },
  ];
  for (const step of steps) {
    const entries = decisions.slice(0, step.lines).map((a) => auditLine(a, step.reasons));
    const trimmed: SharePayload = { ...full, candidates: full.candidates.slice(0, step.candidates), audit: { ...full.audit, entries, note: entries.length < decisions.length ? `Showing the newest ${entries.length} of ${decisions.length} decisions${step.reasons ? "" : " (reasons left out)"}; the full log is in the studio session.` : undefined } };
    if (sharePath(trimmed).length <= MAX_SHARE_PATH) return trimmed;
  }
  const entries = decisions.slice(0, 4).map((a) => auditLine(a, false));
  return { ...full, candidates: full.candidates.slice(0, 12), audit: { ...full.audit, entries, note: `Showing the newest ${entries.length} of ${decisions.length} decisions; the link would otherwise be too long.` } };
}

function buildSharePayloadUnbounded(plan: Plan, policy: Policy, audit: AuditEntry[], now = new Date()): SharePayload {
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
    ? { against: cmp.against, label: cmp.label, swappedIn: cmp.swappedIn.map((s) => s.city), swappedOut: cmp.swappedOut.map((s) => s.city), avgAffinity: cmp.avgAffinity, totalKm: cmp.totalKm, openers: cmp.openers, brands: cmp.brands, baselineStops: cmp.baseline.stops.map((s) => ({ order: s.order, city: s.city, score: s.score })), policy: cmp.policy ? { label: cmp.policy.label, flips: cmp.policy.decisions.filter((d) => d.underA !== d.underB).map((d) => `${d.action}: ${d.underA === "allow" ? "allowed" : d.underA === "approve" ? "needs approval" : "denied"} under A, ${d.underB === "allow" ? "allowed" : d.underB === "approve" ? "needs approval" : "denied"} under B [${d.underB === "allow" ? d.ruleA : d.ruleB}]`) } : undefined }
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
    audience: plan.audience?.summary,
    cobill: plan.coBill ? { opener: plan.coBill.opener.name, detail: plan.coBill.opener.detail, stopsAppeared: plan.coBill.stopsAppeared, ofStops: plan.coBill.ofStops, meanAffinity: plan.coBill.meanAffinity, method: plan.coBill.method, note: plan.coBill.methodNote, locals: plan.coBill.locals } : undefined,
    policy: { maxCities: policy.maxCities, budgetPerCity: policy.budgetPerCity, regions: policy.regions, excludeCities: policy.excludeCities, venue: policy.venue, minGapDays: policy.minGapDays, blackoutDates: policy.blackoutDates, heldVenues: policy.heldVenues, minKmBetweenStops: policy.minKmBetweenStops, maxKmPerLeg: policy.maxKmPerLeg, approvals: { itinerary: policy.approvals.itinerary, alwaysAsk: policy.approvals.alwaysAsk, neverAllow: policy.approvals.neverAllow } },
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
      total: audit.length,
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
    if (!p || typeof p !== "object" || !SHARE_VERSIONS_ACCEPTED.includes(p.v) || !Array.isArray(p.stops) || !p.act?.name) return undefined;
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
