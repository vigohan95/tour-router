/** Itinerary exports: CSV, Markdown and JSON. Pure functions, used by the UI's export buttons. */
import type { Itinerary } from "./types";

const q = (v: unknown): string => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const CSV_COLUMNS = ["order", "date", "city", "country", "affinity", "venue", "capacity", "estimated_cost_usd", "opener", "brand", "leg_km", "lat", "lon"] as const;

export function itineraryToCsv(it: Itinerary): string {
  const rows = it.stops.map((s) => [s.order, s.date, s.city, s.country, s.score, s.venue?.name, s.venue?.capacity, s.venue?.estimatedCostUsd, s.opener?.name, s.brand?.name, s.legKm, s.lat, s.lon].map(q).join(","));
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

export function itineraryToMarkdown(it: Itinerary): string {
  const head = `# ${it.act.name} - ${it.stops.length}-stop tour (${it.startDate} to ${it.endDate})\n\n${it.totalKm.toLocaleString("en-US")} km of travel, estimated venue cost ${it.estimatedCostUsd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}. Data: ${it.mode === "live" ? "Qloo (live)" : "synthetic fixtures (not Qloo data)"}.\n\n`;
  const table = ["| # | Date | City | Affinity | Venue | Opener | Brand | Leg |", "|---|---|---|---|---|---|---|---|", ...it.stops.map((s) => `| ${s.order} | ${s.date} | ${s.city}, ${s.country} | ${Math.round(s.score * 100)}% | ${s.venue ? `${s.venue.name}${s.venue.capacity ? ` (${s.venue.capacity.toLocaleString("en-US")})` : ""}` : "-"} | ${s.opener?.name ?? "-"} | ${s.brand?.name ?? "-"} | ${s.legKm ? `${s.legKm.toLocaleString("en-US")} km` : "-"} |`)].join("\n");
  return head + table + "\n";
}

export function itineraryToJson(it: Itinerary): string {
  return JSON.stringify(it, null, 2);
}
