/**
 * The agent's tool set. Each tool wraps one action, re-checks the policy at execution time (the same
 * evaluation the toolApproval gate saw) and writes to the audit log.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { REGIONS } from "../tour/cities";
import { buildItinerary, excludeCity, explainChoice, pickPartners, rankCities, resolveArtist, setAct } from "../tour/actions";
import { compareText, compareWith } from "../tour/compare";
import { QlooError } from "../qloo/types";
import type { Region } from "../tour/cities";
import { evaluateAction, type Evaluation } from "../policy/engine";
import { audit, getStore } from "../store";

function summarize(value: unknown, max = 600): unknown {
  try {
    const s = JSON.stringify(value);
    return s.length > max ? s.slice(0, max) + "..." : value;
  } catch {
    return String(value);
  }
}

function evaluateNow(name: string, input: unknown): Evaluation {
  const store = getStore();
  return evaluateAction(name, input, { policy: store.policy, plan: store.plan });
}

function logExecution(name: string, input: unknown, ev: Evaluation, output: unknown, error?: string) {
  audit({
    actor: "agent",
    tool: name,
    action: error ? `${ev.summary} - failed` : ev.summary,
    decision: error ? "error" : ev.decision === "approve" ? "approved" : "allowed",
    reason: error ?? (ev.decision === "approve" ? `You approved this. ${ev.reason}` : ev.reason),
    rule: ev.rule,
    input: summarize(input),
    output: summarize(output),
  });
}

/** Run `fn` with policy re-check + audit; errors come back as `{ error }` so the model can explain them. */
function guarded<I, O>(name: string, fn: (input: I) => Promise<O>) {
  return async (input: I): Promise<O | { error: string }> => {
    const ev = evaluateNow(name, input);
    if (ev.decision === "deny") {
      logExecution(name, input, ev, undefined, ev.reason);
      return { error: ev.reason };
    }
    try {
      const out = await fn(input);
      logExecution(name, input, ev, out);
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // A Qloo failure is shown as a banner and never papered over with fixtures or guesses.
      if (e instanceof QlooError || /^Qloo /.test(message)) getStore().plan.lastError = { ts: new Date().toISOString(), message, status: e instanceof QlooError ? e.status : undefined, tool: name };
      logExecution(name, input, ev, undefined, message);
      return { error: message };
    }
  };
}

function requireAct() {
  const act = getStore().plan.act;
  if (!act) throw new Error("No act selected yet. Call resolve_artist first and pick one of its hits.");
  return act;
}

export function buildTools(): ToolSet {
  return {
    resolve_artist: tool({
      description: "Find the act (musician, band, comedian, podcast) on Qloo by name. Returns candidate entity ids; the first hit is selected as the act for the rest of the plan unless `entity_id` is given.",
      inputSchema: z.object({ query: z.string().min(1).describe("The act's name as the user typed it"), entity_id: z.string().optional().describe("Pick this exact hit instead of the first one") }),
      execute: guarded("resolve_artist", async ({ query, entity_id }) => {
        const r = await resolveArtist(query);
        const chosen = (entity_id ? r.hits.find((h) => h.entity_id === entity_id) : undefined) ?? r.hits[0];
        if (chosen) setAct(getStore().plan, chosen);
        return { ...r, selected: chosen };
      }),
    }),

    rank_cities_by_affinity: tool({
      description: "Rank candidate cities by fan affinity from ONE Qloo heatmap per country (filter.type=urn:heatmap, filter.location.query=<country>; cached), binned to each city (cells within 60 km, mean of the strongest 5). Returns affinity, a 0-100 index across the candidates, listener density (popularity), metro-size rank and the taste lift (population rank minus taste rank), plus flags for excluded or unscored cities.",
      inputSchema: z.object({
        regions: z.array(z.enum(REGIONS as [string, ...string[]])).optional().describe("Regions to consider; defaults to the policy's regions"),
        limit: z.number().int().min(1).max(60).optional().describe("Keep only the top N"),
        only: z.array(z.string()).optional().describe("Restrict to these city names"),
      }),
      execute: guarded("rank_cities_by_affinity", async ({ regions, limit, only }) => {
        const store = getStore();
        const act = requireAct();
        const ranked = await rankCities(act, store.policy, { regions: regions as Region[] | undefined, limit, only });
        store.plan.candidates = ranked;
        store.plan.region = (regions as Region[] | undefined) ?? (store.policy.regions as Region[]);
        store.version++;
        return { act: act.name, count: ranked.length, cities: ranked.map((c) => ({ rank: c.rank, city: c.city, country: c.country, score: c.score, index: c.index, popularityRank: c.popularityRank, populationRank: c.populationRank, lift: c.lift, excluded: c.excluded ?? false, ...(c.noSignal ? { unscored: c.note ?? "no Qloo signal" } : {}) })) };
      }),
    }),

    pick_city_partners: tool({
      description: "For one city: the venues (inside the policy's capacity window), brands and opening acts whose audiences overlap the act's, each with Qloo explainability. Call it for every city you intend to route.",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: guarded("pick_city_partners", async ({ city }) => {
        const store = getStore();
        const act = requireAct();
        const p = await pickPartners(act, city, store.policy, store.plan);
        const slim = (x: { name: string; affinity: number; detail?: string; capacity?: number; estimatedCostUsd?: number }) => ({ name: x.name, affinity: x.affinity, detail: x.detail, capacity: x.capacity, estimatedCostUsd: x.estimatedCostUsd });
        return { city: p.city, recommendedVenue: p.recommendedVenue ? slim(p.recommendedVenue) : undefined, venues: p.venues.slice(0, 4).map(slim), brands: p.brands.slice(0, 3).map(slim), openers: p.openers.slice(0, 3).map(slim), why: p.why };
      }),
    }),

    build_itinerary: tool({
      description: "Order the chosen cities into a route (nearest-neighbour + 2-opt), assign show dates and attach each city's recommended venue, opener and brand. Over the city cap or the per-city budget this asks the user first.",
      inputSchema: z.object({
        cities: z.array(z.string()).min(1).describe("City names to route, from the ranked candidates"),
        startCity: z.string().optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("yyyy-mm-dd; defaults to the 1st of next month"),
        gapDays: z.number().int().min(1).max(14).optional(),
      }),
      execute: guarded("build_itinerary", async (input) => {
        const store = getStore();
        const act = requireAct();
        const it = buildItinerary(act, store.plan, store.policy, input);
        return { id: it.id, stops: it.stops.map((s) => ({ order: s.order, city: s.city, date: s.date, venue: s.venue?.name, opener: s.opener?.name, brand: s.brand?.name, legKm: s.legKm })), totalKm: it.totalKm, startDate: it.startDate, endDate: it.endDate, estimatedCostUsd: it.estimatedCostUsd };
      }),
    }),

    explain_choice: tool({
      description: "Explain why a city is where it is in the plan: its Qloo affinity, index and rank, the chosen venue/brand/opener and the explainability contributions behind them.",
      inputSchema: z.object({ city: z.string().min(1) }),
      execute: guarded("explain_choice", async ({ city }) => explainChoice(getStore().plan, city)),
    }),

    compare_plans: tool({
      description: "Counterfactual: diff the current itinerary against a baseline with the same stop count - \"population\" (biggest metros, no Qloo), \"popularity\" (Qloo listener density, not affinity) or \"previous\" (the itinerary the last rebuild replaced). Returns swapped-in / swapped-out cities, the change in average fan affinity, km and estimated cost, and the openers / brands gained or lost. Read-only. Call it after exclude_city + build_itinerary (against=previous) and whenever the user asks what Qloo changed.",
      inputSchema: z.object({ against: z.enum(["population", "popularity", "previous"]).default("population") }),
      execute: guarded("compare_plans", async ({ against }) => {
        const store = getStore();
        const act = requireAct();
        const r = compareWith(act, store.plan, store.policy, against);
        store.version++;
        return { against, label: r.label, swappedIn: r.swappedIn.map((s) => s.city), swappedOut: r.swappedOut.map((s) => s.city), avgAffinity: r.avgAffinity, totalKm: r.totalKm, estimatedCostUsd: r.estimatedCostUsd, openers: r.openers, brands: r.brands, summary: compareText(r, act.name) };
      }),
    }),

    exclude_city: tool({
      description: "Mark a ranked city as excluded (or un-exclude it). Excluded cities are never routed.",
      inputSchema: z.object({ city: z.string().min(1), excluded: z.boolean().default(true), reason: z.string().optional() }),
      execute: guarded("exclude_city", async ({ city, excluded, reason }) => {
        const c = excludeCity(getStore().plan, city, excluded, reason);
        if (!c) throw new Error(`"${city}" is not in the ranked candidates.`);
        return { city: c.city, excluded: c.excluded ?? false };
      }),
    }),
  };
}
