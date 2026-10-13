/** Pure text helpers for counterfactuals; no server imports, so client components can use them. */
import type { CompareResult } from "./types";

export const BASELINE_LABEL: Record<CompareResult["against"], string> = {
  population: "population-only routing (biggest metros, no Qloo)",
  popularity: "popularity-only routing (Qloo listener density, not affinity)",
  previous: "the previous itinerary",
};

/** One-paragraph summary for the agent and the share page. */
export function compareText(r: CompareResult, actName: string): string {
  const pp = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n * 100)} pts`;
  const km = (n: number) => `${n >= 0 ? "+" : ""}${n.toLocaleString("en-US")} km`;
  const parts = [`Against ${r.label}: ${r.swappedIn.length ? `taste swaps in ${r.swappedIn.map((s) => s.city).join(", ")}` : "the same cities"}${r.swappedOut.length ? ` and drops ${r.swappedOut.map((s) => s.city).join(", ")}` : ""}.`];
  parts.push(`Average fan affinity ${Math.round(r.avgAffinity.plan * 100)}% vs ${Math.round(r.avgAffinity.baseline * 100)}% (${pp(r.avgAffinity.delta)}), travel ${r.totalKm.plan.toLocaleString("en-US")} km vs ${r.totalKm.baseline.toLocaleString("en-US")} km (${km(r.totalKm.delta)}).`);
  if (r.openers.gained.length) parts.push(`Openers only the taste route carries: ${r.openers.gained.join(", ")}.`);
  if (r.brands.gained.length) parts.push(`Brands only the taste route carries: ${r.brands.gained.join(", ")}.`);
  if (r.openers.lost.length || r.brands.lost.length) parts.push(`Given up: ${[...r.openers.lost, ...r.brands.lost].join(", ")}.`);
  if (r.swappedIn.length === 0 && r.swappedOut.length === 0) parts.push(`For ${actName}, taste and ${r.against} agree on the cities here.`);
  return parts.join(" ");
}
