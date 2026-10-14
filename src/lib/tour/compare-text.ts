/** Pure text helpers for counterfactuals; no server imports, so client components can use them. */
import type { CompareResult } from "./types";

export const BASELINE_LABEL: Record<CompareResult["against"], string> = {
  population: "population-only routing (biggest metros, no Qloo)",
  popularity: "popularity-only routing (Qloo listener density, not affinity)",
  previous: "the previous itinerary",
  cobill: "the co-bill route (cities ranked on headliner + tour opener joint affinity)",
};

/** One-paragraph summary for the agent and the share page. */
export function compareText(r: CompareResult, actName: string): string {
  const pp = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n * 100)} pts`;
  const km = (n: number) => (n === 0 ? "the same distance" : `${Math.abs(n).toLocaleString("en-US")} km ${n > 0 ? "more" : "fewer"}`);
  if (r.against === "cobill") {
    const j = r.avgJointAffinity;
    const parts = [`Against ${r.label}: ${r.swappedOut.length ? `the co-bill route would add ${r.swappedOut.map((s) => s.city).join(", ")}` : "the same cities"}${r.swappedIn.length ? ` and drop ${r.swappedIn.map((s) => s.city).join(", ")}` : ""}.`];
    parts.push(`Headliner-only affinity ${Math.round(r.avgAffinity.plan * 100)}% (current route) vs ${Math.round(r.avgAffinity.baseline * 100)}% (co-bill route)${j ? `; joint affinity ${(j.plan * 100).toFixed(1)}% vs ${(j.baseline * 100).toFixed(1)}% (${j.delta <= 0 ? "+" : "-"}${Math.abs(j.delta * 100).toFixed(1)} pts for the co-bill route)` : ""}; travel ${r.totalKm.plan.toLocaleString("en-US")} km vs ${r.totalKm.baseline.toLocaleString("en-US")} km.`);
    if (r.swappedIn.length === 0 && r.swappedOut.length === 0) parts.push(`For ${actName}, the pairing does not change the cities, only how strongly they index.`);
    return parts.join(" ");
  }
  const parts = [`Against ${r.label}: ${r.swappedIn.length ? `taste swaps in ${r.swappedIn.map((s) => s.city).join(", ")}` : "the same cities"}${r.swappedOut.length ? ` and drops ${r.swappedOut.map((s) => s.city).join(", ")}` : ""}.`];
  parts.push(`Average fan affinity ${Math.round(r.avgAffinity.plan * 100)}% vs ${Math.round(r.avgAffinity.baseline * 100)}% (${pp(r.avgAffinity.delta)}); travel ${r.totalKm.plan.toLocaleString("en-US")} km vs ${r.totalKm.baseline.toLocaleString("en-US")} km, ${km(r.totalKm.delta)} for the taste route.`);
  if (r.openers.gained.length) parts.push(`Openers only the taste route carries: ${r.openers.gained.join(", ")}.`);
  if (r.brands.gained.length) parts.push(`Brands only the taste route carries: ${r.brands.gained.join(", ")}.`);
  if (r.openers.lost.length || r.brands.lost.length) parts.push(`Given up: ${[...r.openers.lost, ...r.brands.lost].join(", ")}.`);
  if (r.swappedIn.length === 0 && r.swappedOut.length === 0) parts.push(`For ${actName}, taste and ${r.against} agree on the cities here.`);
  return parts.join(" ");
}
