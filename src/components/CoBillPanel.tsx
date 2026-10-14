"use client";

import type { Act, CoBill } from "@/lib/tour/types";
import { pct, pct1 } from "./grid";

/**
 * Tour opener + co-bill markets: one support act for the whole run (the act that recurs across the routed cities'
 * opener lists), and every candidate city re-scored on a heatmap signalled by headliner + opener together.
 */
export default function CoBillPanel({ act, coBill, partnersCount, busy, error, onPick, onCompare }: { act?: Act; coBill?: CoBill; partnersCount: number; busy: boolean; error?: string; onPick: (openerEntityId?: string) => void; onCompare: () => void }) {
  if (!act || partnersCount < 2) return null;
  const who = act.kind === "person" ? "comic" : "act";
  return (
    <div className="card" data-panel="cobill">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">3b. Tour opener and co-bill markets</div>
        <span className="text-xs text-muted">One support {who} for the whole run, then the markets ranked on the pairing (one Qloo heatmap per country signalled by both acts).</span>
        <span className="ml-auto flex gap-1">
          <button className="btn btn-primary" disabled={busy} onClick={() => onPick()} title="Intersect the per-city opener lists already fetched; then one joint heatmap per country">
            {coBill ? "Recompute" : "Find tour opener"}
          </button>
          {coBill && (
            <button className="btn" disabled={busy} onClick={onCompare} title="Diff the headliner-only route against the route the joint heatmap would pick">
              Compare co-bill route
            </button>
          )}
        </span>
      </div>
      {error && <div className="mt-2 text-xs text-bad">{error}</div>}
      {!coBill && <p className="mt-2 text-xs text-muted">The per-city opener lists are already here (signal.location.query per city). The tour opener is the {who} that appears in the most routed cities&apos; lists, ranked by stops appeared in, then mean affinity; the per-city locals stay as alternates.</p>}
      {coBill && (
        <div className="mt-2 grid gap-3 text-sm md:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-warn">Tour opener</div>
              <div className="mt-0.5 text-base font-semibold">{coBill.opener.name}</div>
              <div className="text-xs text-muted">
                {coBill.opener.detail ? `${coBill.opener.detail}; ` : ""}in the top openers of <b>{coBill.stopsAppeared} of {coBill.ofStops}</b> routed cities, mean affinity {pct(coBill.meanAffinity)}
              </div>
            </div>
            {coBill.alternates.length > 0 && (
              <div className="mt-2 text-xs">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Runners-up (whole run)</div>
                <ul className="mt-0.5 space-y-0.5">
                  {coBill.alternates.map((a) => (
                    <li key={a.entity_id} className="flex items-baseline gap-2">
                      <button className="text-accent underline" disabled={busy} onClick={() => onPick(a.entity_id)} title="Use this act as the tour opener instead">
                        {a.name}
                      </button>
                      <span className="text-muted">
                        {a.stopsAppeared}/{a.ofStops} stops, {pct(a.meanAffinity)}
                        {a.detail ? `, ${a.detail}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Object.keys(coBill.locals).length > 0 && (
              <div className="mt-2 text-xs">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Local alternates (city&apos;s own #1)</div>
                <ul className="mt-0.5 text-muted">
                  {Object.entries(coBill.locals).map(([city, name]) => (
                    <li key={city}>
                      {city}: {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Co-bill markets: {act.name} + {coBill.opener.name} {coBill.method === "averaged" ? <span className="ml-1 rounded bg-amber-200 px-1 text-amber-900">averaged fallback</span> : null}
            </div>
            <table className="mt-1 w-full text-xs tabular-nums">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="pr-2">city</th>
                  <th className="pr-2">headliner-only</th>
                  <th className="pr-2">co-bill</th>
                  <th className="pr-2">delta</th>
                  <th>rank</th>
                </tr>
              </thead>
              <tbody>
                {coBill.cities.slice(0, 12).map((r) => (
                  <tr key={r.city} className="border-t border-border">
                    <td className="pr-2">{r.city}</td>
                    <td className="pr-2">{pct1(r.headliner)}</td>
                    <td className="pr-2 font-medium">{pct1(r.joint)}</td>
                    <td className={`pr-2 ${r.delta >= 0 ? "text-ok" : "text-bad"}`}>
                      {r.delta >= 0 ? "+" : ""}
                      {(r.delta * 100).toFixed(1)} pts
                    </td>
                    <td className={r.jointRank < r.headlinerRank ? "text-ok" : r.jointRank > r.headlinerRank ? "text-bad" : "text-muted"}>
                      #{r.headlinerRank} {"->"} #{r.jointRank}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">{coBill.methodNote}</p>
          </div>
        </div>
      )}
    </div>
  );
}
