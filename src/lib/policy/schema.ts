import { z } from "zod";
import { REGIONS } from "../tour/cities";

/**
 * The promoter's routing policy. "Policy is configuration": the agent acts freely inside these bounds, asks at
 * the edges, and is refused beyond them. Every decision cites the field it came from.
 */
export const PolicySchema = z.object({
  /** Hard cap on cities in one itinerary; a bigger request asks you first. */
  maxCities: z.number().int().min(1).max(40).default(12),
  /** Estimated venue cost per city (USD) the agent may commit to on its own; above it the stop asks you. */
  budgetPerCity: z.number().min(0).default(30000),
  /** Cities the agent must never route (already played, embargoed, no visa...). Case-insensitive names. */
  excludeCities: z.array(z.string()).default([]),
  /** Regions the agent may plan in. Empty = anywhere. */
  regions: z.array(z.enum(REGIONS as [string, ...string[]])).default(["North America"]),
  venue: z.object({
    /** Only venues inside this capacity window are recommended. */
    minCapacity: z.number().int().min(0).default(1500),
    maxCapacity: z.number().int().min(0).default(5000),
  }),
  /** Minimum days between consecutive shows. */
  minGapDays: z.number().int().min(1).max(14).default(2),
  approvals: z.object({
    /** "auto": build the itinerary without asking when it is inside every bound; "ask": always show it first. */
    itinerary: z.enum(["auto", "ask"]).default("auto"),
    alwaysAsk: z.array(z.string()).default([]),
    neverAllow: z.array(z.string()).default([]),
  }),
});

export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({ venue: {}, approvals: {} });

/** Parse a partial policy (e.g. from the UI) on top of the defaults. */
export function parsePolicy(input: unknown): Policy {
  const partial = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  return PolicySchema.parse({
    ...DEFAULT_POLICY,
    ...partial,
    venue: { ...DEFAULT_POLICY.venue, ...(partial.venue as object | undefined) },
    approvals: { ...DEFAULT_POLICY.approvals, ...(partial.approvals as object | undefined) },
  });
}

export function isExcluded(policy: Policy, city: string): boolean {
  const c = city.trim().toLowerCase();
  return policy.excludeCities.some((x) => x.trim().toLowerCase() === c);
}
