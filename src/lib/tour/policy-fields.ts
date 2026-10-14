/** Client-safe names and types for the policy counterfactual (no server imports, so components can use them). */

export type PolicyField = "maxCities" | "excludeCities" | "minKmBetweenStops" | "blackoutDates" | "maxKmPerLeg" | "minGapDays";

export const POLICY_FIELDS: PolicyField[] = ["maxCities", "excludeCities", "minKmBetweenStops", "blackoutDates", "maxKmPerLeg", "minGapDays"];

export interface PolicyChange {
  field: PolicyField;
  /** maxCities / minKmBetweenStops / minGapDays: a number; maxKmPerLeg: a number or null (no cap); excludeCities / blackoutDates: names or dates to ADD. */
  value: number | string | string[] | null;
}

export const FIELD_LABEL: Record<PolicyField, string> = { maxCities: "city cap", excludeCities: "excluded cities", minKmBetweenStops: "radius clause", blackoutDates: "blackout dates", maxKmPerLeg: "max km per leg", minGapDays: "min days between shows" };
