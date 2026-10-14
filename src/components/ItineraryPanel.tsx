"use client";

import { useState } from "react";
import { itineraryToCsv, itineraryToJson, itineraryToMarkdown } from "@/lib/tour/export";
import type { Itinerary } from "@/lib/tour/types";
import { pct, usd } from "./grid";

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ItineraryPanel({ itinerary, onReroute, onShare, shared }: { itinerary?: Itinerary; onReroute: () => void; onShare?: () => void; shared?: string }) {
  const [copied, setCopied] = useState(false);
  if (!itinerary) {
    return (
      <div className="card text-sm text-muted">
        <div className="text-sm font-semibold text-foreground">5. Itinerary</div>
        <p className="mt-1">The agent routes the chosen cities (nearest neighbour + 2-opt), spaces the dates by your policy and attaches each city&apos;s venue, opener and brand. Export as CSV, Markdown or JSON.</p>
      </div>
    );
  }
  const slug = itinerary.act.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">5. Itinerary</div>
        <span className="text-xs text-muted">
          {itinerary.act.name} - {itinerary.stops.length} stops, {itinerary.startDate} to {itinerary.endDate}, {itinerary.totalKm.toLocaleString("en-US")} km{itinerary.estimatedCostUsd > 0 ? `, est. venues ${usd(itinerary.estimatedCostUsd)}` : ""}
        </span>
        <span className="ml-auto flex flex-wrap gap-1">
          {onShare && (
            <button className="btn btn-primary" onClick={onShare} title="Read-only page with the whole plan in the link (no account, no agent run needed); printable as a promoter brief">
              {shared ?? "Share link"}
            </button>
          )}
          <button className="btn" onClick={onReroute} title="Re-optimise the order of the current stops">
            Re-route
          </button>
          <button className="btn" onClick={() => download(`${slug}-tour.csv`, itineraryToCsv(itinerary), "text/csv")}>
            CSV
          </button>
          <button className="btn" onClick={() => download(`${slug}-tour.json`, itineraryToJson(itinerary), "application/json")}>
            JSON
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(itineraryToMarkdown(itinerary));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                download(`${slug}-tour.md`, itineraryToMarkdown(itinerary), "text/markdown");
              }
            }}
          >
            {copied ? "Copied" : "Copy Markdown"}
          </button>
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Date</th>
              <th className="py-1 pr-2">City</th>
              <th className="py-1 pr-2">Affinity</th>
              <th className="py-1 pr-2">Venue</th>
              <th className="py-1 pr-2">Opener</th>
              <th className="py-1 pr-2">Brand</th>
              <th className="py-1 pr-2 text-right">Leg</th>
            </tr>
          </thead>
          <tbody>
            {itinerary.stops.map((s) => (
              <tr key={s.city} className="border-t border-border">
                <td className="py-1 pr-2 font-semibold">{s.order}</td>
                <td className="py-1 pr-2 tabular-nums">{s.date}</td>
                <td className="py-1 pr-2">
                  {s.city}, {s.country}
                </td>
                <td className="py-1 pr-2 tabular-nums">{pct(s.score)}</td>
                <td className="py-1 pr-2">
                  {s.held && <span className="mr-1 rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white" title="Promoter hold (policy.heldVenues): pinned to this date and venue">HELD</span>}
                  {s.venue?.name ?? "-"}
                  {s.venue?.capacity ? <span className="text-xs text-muted"> ({s.venue.capacity.toLocaleString("en-US")})</span> : s.venue?.detail ? <span className="text-xs text-muted"> ({s.venue.detail})</span> : null}
                </td>
                <td className="py-1 pr-2">{s.opener?.name ?? "-"}</td>
                <td className="py-1 pr-2">{s.brand?.name ?? "-"}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{s.legKm ? `${s.legKm.toLocaleString("en-US")} km` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
