import type { Plan } from "../tour/types";
import { isExcluded, type Policy } from "./schema";

export type Decision = "allow" | "approve" | "deny";

export interface Evaluation {
  decision: Decision;
  reason: string;
  /** Short human label for the audit timeline / approval card. */
  summary: string;
  /** The policy field (JSON path) the decision came from, so the ledger can cite it. */
  rule: string;
}

export interface EvaluationContext {
  policy: Policy;
  plan: Plan;
}

/** Tools that only read Qloo or local state. They never need approval. */
export const READ_ONLY_TOOLS = ["resolve_artist", "rank_cities_by_affinity", "explain_choice", "compare_plans"];

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.includes(name);
}

type Input = Record<string, unknown>;
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Decide whether a tool call may run, needs a human, or is refused. Pure: no I/O, so it is unit-testable and
 * safe to call from the AI SDK's `toolApproval` hook and again at execution time.
 */
export function evaluateAction(tool: string, rawInput: unknown, ctx: EvaluationContext): Evaluation {
  const input: Input = rawInput && typeof rawInput === "object" ? (rawInput as Input) : {};
  const { policy, plan } = ctx;

  if (policy.approvals.neverAllow.includes(tool)) {
    return { decision: "deny", reason: `Policy: "${tool}" is on the never-allow list.`, summary: tool, rule: "approvals.neverAllow" };
  }
  if (isReadOnlyTool(tool)) {
    if (tool === "rank_cities_by_affinity") {
      const regions = strs(input.regions);
      const outside = regions.filter((r) => policy.regions.length && !policy.regions.includes(r));
      if (outside.length) return { decision: "deny", reason: `Policy limits planning to ${policy.regions.join(", ")}; ${outside.join(", ")} is outside it.`, summary: `Rank cities in ${regions.join(", ")}`, rule: "regions" };
    }
    return { decision: "allow", reason: "Read-only: queries Qloo, changes nothing.", summary: tool.replaceAll("_", " "), rule: "read-only" };
  }
  if (policy.approvals.alwaysAsk.includes(tool)) {
    return { decision: "approve", reason: `Policy: "${tool}" always needs your approval.`, summary: tool, rule: "approvals.alwaysAsk" };
  }

  switch (tool) {
    case "pick_city_partners": {
      const city = String(input.city ?? "");
      const summary = `Find partners in ${city}`;
      if (isExcluded(policy, city)) return { decision: "deny", reason: `${city} is on your exclude list.`, summary, rule: "excludeCities" };
      const ranked = plan.candidates.find((c) => c.city.toLowerCase() === city.toLowerCase());
      if (ranked?.excluded) return { decision: "deny", reason: `${city} was excluded in the city grid${ranked.excludedReason ? ` (${ranked.excludedReason})` : ""}.`, summary, rule: "grid.excluded" };
      return { decision: "allow", reason: "Looks up venues, brands and openers; commits to nothing.", summary, rule: "read-only" };
    }

    case "build_itinerary": {
      const cities = strs(input.cities);
      const summary = `Build a ${cities.length}-stop itinerary`;
      const excluded = cities.filter((c) => isExcluded(policy, c) || plan.candidates.find((x) => x.city.toLowerCase() === c.toLowerCase())?.excluded);
      if (excluded.length) return { decision: "deny", reason: `${excluded.join(", ")} ${excluded.length === 1 ? "is" : "are"} excluded; drop ${excluded.length === 1 ? "it" : "them"} and try again.`, summary, rule: "excludeCities" };
      if (cities.length > policy.maxCities) return { decision: "approve", reason: `${cities.length} stops is over your ${policy.maxCities}-city cap.`, summary, rule: "maxCities" };
      const over = cities.filter((c) => {
        const v = plan.partners[c]?.recommendedVenue;
        return v?.estimatedCostUsd !== undefined && v.estimatedCostUsd > policy.budgetPerCity;
      });
      if (over.length) {
        return { decision: "approve", reason: `Estimated venue cost in ${over.join(", ")} is above your ${usd(policy.budgetPerCity)} per-city budget.`, summary, rule: "budgetPerCity" };
      }
      if (policy.approvals.itinerary === "ask") return { decision: "approve", reason: "Policy: itineraries always ask (approvals.itinerary = ask).", summary, rule: "approvals.itinerary" };
      return { decision: "allow", reason: `${cities.length} stops, inside the ${policy.maxCities}-city cap and the ${usd(policy.budgetPerCity)} per-city budget.`, summary, rule: "maxCities" };
    }

    case "exclude_city": {
      return { decision: "allow", reason: "Local setting only.", summary: `Exclude ${String(input.city ?? "")}`, rule: "default-allow" };
    }

    default:
      return { decision: "approve", reason: `No policy rule for "${tool}"; defaulting to ask.`, summary: tool, rule: "default-ask" };
  }
}
