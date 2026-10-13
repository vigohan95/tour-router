"use client";

import { useState } from "react";
import { summarizeCalls } from "@/lib/tour/share";
import type { QlooCall } from "@/lib/tour/types";

const TYPE_LABEL: Record<string, string> = {
  "urn:heatmap": "heatmap (one per country): fan affinity + listener density per cell",
  "urn:entity:place": "venues: places in the city whose crowd overlaps the act's fans",
  "urn:entity:brand": "brands the city's audience and the act's fans both over-index on",
  "urn:entity:artist": "openers: trending artists with cross-affinity in this market",
  "urn:entity:person": "openers: trending public figures (comedians) with cross-affinity in this market",
};

/** Provenance: every Qloo request behind the current plan, grouped; the last few in full (ids redacted). */
export default function QlooCallsPanel({ calls, mode }: { calls: QlooCall[]; mode: "fixture" | "live" }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (calls.length === 0) return null;
  const groups = summarizeCalls(calls);
  const cached = calls.filter((c) => c.cached).length;
  return (
    <div className="card" data-panel="qloo-calls">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        <span className="text-sm font-semibold">Qloo calls behind this plan</span>
        <span className="text-xs text-muted">
          {calls.length} requests to {mode === "live" ? "hackathon.api.qloo.com" : "the synthetic fixture adapter"}, {cached} served from the private server cache
        </span>
        <span className="ml-auto text-xs text-accent underline">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <table className="w-full">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pr-2">endpoint</th>
                <th className="py-1 pr-2">filter.type</th>
                <th className="py-1 pr-2">parameters</th>
                <th className="py-1 pr-2 text-right">calls</th>
                <th className="py-1 pr-2 text-right">cached</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={`${g.endpoint}|${g.type}`} className="border-t border-border align-top">
                  <td className="py-1 pr-2 font-mono">GET {g.endpoint}</td>
                  <td className="py-1 pr-2">
                    <div className="font-mono">{g.type || "-"}</div>
                    <div className="text-muted">{TYPE_LABEL[g.type] ?? (g.endpoint === "/search" ? "resolve the act by name" : "")}</div>
                  </td>
                  <td className="py-1 pr-2 font-mono">{g.params.join(", ")}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{g.n}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{g.cached}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button className="text-accent underline" onClick={() => setShowAll(!showAll)}>
              {showAll ? "hide the request log" : `request log (${calls.length}, entity ids redacted)`}
            </button>
            {showAll && (
              <ul className="mt-1 max-h-64 overflow-y-auto font-mono text-[10px]">
                {calls
                  .slice()
                  .reverse()
                  .map((c, i) => (
                    <li key={i} className="border-t border-border py-0.5">
                      <span className="text-muted">{c.ts.slice(11, 19)}</span> GET {c.endpoint}?{Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join("&")} {c.cached ? "[cache]" : `[${c.status ?? "?"} ${c.ms ?? "?"}ms]`}
                      {c.results !== undefined ? ` -> ${c.results} results` : ""}
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <p className="text-muted">Responses are cached privately in server memory for this deployment; nothing is written to disk or to the repository. {mode === "fixture" ? "This session used the synthetic fixture adapter: the calls above are the requests it would have made." : ""}</p>
        </div>
      )}
    </div>
  );
}
