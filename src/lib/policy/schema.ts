import { z } from "zod";
import { REGIONS } from "../tour/cities";

/**
 * The promoter's routing policy. "Policy is configuration": the agent acts freely inside these bounds, asks at
 * the edges, and is refused beyond them. Every decision cites the field it came from.
 *
 * Holds, blackout dates and the radius clause are the promoter's own inputs (what they know from their venue
 * calendar and their contracts), not venue data from Qloo; the agent never has to guess at availability.
 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const HeldVenueSchema = z.object({
  /** Candidate city name (case-insensitive). */
  city: z.string().min(1),
  /** Venue name as the promoter wrote it; matched to the Qloo venue card when the names overlap, otherwise shown as a promoter hold. */
  venue: z.string().min(1),
  /** yyyy-mm-dd: the stop is pinned to this date. */
  date: z.string().regex(ISO_DATE, "date must be yyyy-mm-dd"),
});

export type HeldVenue = z.infer<typeof HeldVenueSchema>;

export const PolicySchema = z.object({
  /** Hard cap on cities in one itinerary; a bigger request asks you first. Default 6, so an 8-city brief shows the approval card. */
  maxCities: z.number().int().min(1).max(40).default(6),
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
  /** Dates (yyyy-mm-dd) that are never show dates: the act's days off, religious holidays, a festival exclusivity window. */
  blackoutDates: z.array(z.string().regex(ISO_DATE, "blackout dates must be yyyy-mm-dd")).default([]),
  /** Venues the promoter already holds: the city is pinned to that date and the stop shows HELD. */
  heldVenues: z.array(HeldVenueSchema).default([]),
  /** Radius clause: no two stops closer than this (km, great circle). A route that breaks it is refused. */
  minKmBetweenStops: z.number().min(0).max(5000).default(160),
  /** Optional cap on one leg's distance (km); a route with a longer leg is refused. */
  maxKmPerLeg: z.number().min(1).max(20000).optional(),
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

const norm = (s: string) => s.trim().toLowerCase();

export function isExcluded(policy: Policy, city: string): boolean {
  const c = norm(city);
  return policy.excludeCities.some((x) => norm(x) === c);
}

export function isBlackout(policy: Pick<Policy, "blackoutDates">, date: string): boolean {
  return policy.blackoutDates.includes(date);
}

/** The promoter's hold for a city, if any (first match wins). */
export function heldFor(policy: Pick<Policy, "heldVenues">, city: string): HeldVenue | undefined {
  const c = norm(city);
  return policy.heldVenues.find((h) => norm(h.city) === c);
}

/** The policy fields that bound a route, in the order the share page and the brief list them. */
export const POLICY_FIELD_LABELS: Record<string, string> = {
  maxCities: "city cap",
  budgetPerCity: "venue budget per city",
  excludeCities: "excluded cities",
  regions: "regions",
  "venue.minCapacity": "min venue capacity",
  "venue.maxCapacity": "max venue capacity",
  minGapDays: "min days between shows",
  blackoutDates: "blackout dates",
  heldVenues: "held venues",
  minKmBetweenStops: "radius clause (min km between stops)",
  maxKmPerLeg: "max km per leg",
  "approvals.itinerary": "itinerary approval",
};
