"use client";

import { compareText } from "@/lib/tour/compare-text";
import type { CompareResult, Itinerary } from "@/lib/tour/types";
import { pct } from "./grid";

const signed = (n: number, unit = "") => `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}${unit}`;

/** Counterfactual card: the taste route against population-only / popularity-only routing or the previous route. */
export default function ComparePanel({ itinerary, compare, busy, onCompare }: { itinerary?: Itinerary; compare?: CompareResult; busy: boolean; onCompare: (against: CompareResult["against"]) => void }) {
  if (!itinerary) return null;
  return (
    <div className="card" data-panel="compare">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">6. What did taste change?</div>
        <span className="text-xs text-muted">Same stop count, same dates, same routing; only the city choice differs.</span>
        <span className="ml-auto flex gap-1">
          <button className={`btn ${compare?.against === "population" ? "btn-primary" : ""}`} disabled={busy} onClick={() => onCompare("population")} title="Biggest metros first, no Qloo">
            vs population
          </button>
          <button className={`btn ${compare?.against === "popularity" ? "btn-primary" : ""}`} disabled={busy} onClick={() => onCompare("popularity")} title="Qloo listener density (volume), not affinity">
            vs listeners
          </button>
          <button className={`btn ${compare?.against === "previous" ? "btn-primary" : ""}`} disabled={busy} onClick={() => onCompare("previous")} title="The itinerary the last rebuild replaced">
            vs previous
          </button>
        </span>
      </div>
      {!compare && <p className="mt-2 text-xs text-muted">Pick a baseline to see which cities Qloo swapped in and out, and what that cost or gained in fan affinity, travel and partners.</p>}
      {compare && (
        <div className="mt-2 grid gap-3 text-sm md:grid-cols-[1fr_1fr_auto]">
          <div className="rounded-md border border-green-300 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ok">Taste route adds</div>
            <ul className="mt-1 space-y-0.5">
              {compare.swappedIn.length === 0 && <li className="text-xs text-muted">nothing: same cities</li>}
              {compare.swappedIn.map((s) => (
                <li key={s.city}>
                  <span className="font-medium">{s.city}</span> <span className="text-xs text-muted">{pct(s.score)} affinity{s.venue ? ` - ${s.venue.name}` : ""}{s.opener ? `, opener ${s.opener.name}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bad">{compare.against === "previous" ? "Dropped since the previous route" : `${compare.against === "population" ? "Population-only" : "Listener-only"} routing would pick instead`}</div>
            <ul className="mt-1 space-y-0.5">
              {compare.swappedOut.length === 0 && <li className="text-xs text-muted">nothing</li>}
              {compare.swappedOut.map((s) => (
                <li key={s.city}>
                  <span className="font-medium">{s.city}</span> <span className="text-xs text-muted">{pct(s.score)} affinity{s.venue ? ` - ${s.venue.name}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
          <table className="text-xs tabular-nums">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="pr-3">metric</th>
                <th className="pr-3">taste</th>
                <th className="pr-3">baseline</th>
                <th>delta</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="pr-3">avg fan affinity</td>
                <td className="pr-3">{pct(compare.avgAffinity.plan)}</td>
                <td className="pr-3">{pct(compare.avgAffinity.baseline)}</td>
                <td className={compare.avgAffinity.delta >= 0 ? "text-ok" : "text-bad"}>{signed(Math.round(compare.avgAffinity.delta * 100), " pts")}</td>
              </tr>
              <tr>
                <td className="pr-3">travel</td>
                <td className="pr-3">{compare.totalKm.plan.toLocaleString("en-US")} km</td>
                <td className="pr-3">{compare.totalKm.baseline.toLocaleString("en-US")} km</td>
                <td className={compare.totalKm.delta <= 0 ? "text-ok" : "text-warn"}>{compare.totalKm.delta === 0 ? "same" : `${Math.abs(compare.totalKm.delta).toLocaleString("en-US")} km ${compare.totalKm.delta > 0 ? "more" : "fewer"}`}</td>
              </tr>
              <tr>
                <td className="pr-3">openers</td>
                <td className="pr-3" colSpan={3}>
                  {compare.openers.gained.length ? <span className="text-ok">+{compare.openers.gained.join(", ")}</span> : null} {compare.openers.lost.length ? <span className="text-bad">-{compare.openers.lost.join(", ")}</span> : null}
                  {!compare.openers.gained.length && !compare.openers.lost.length ? <span className="text-muted">same</span> : null}
                </td>
              </tr>
              <tr>
                <td className="pr-3">brands</td>
                <td className="pr-3" colSpan={3}>
                  {compare.brands.gained.length ? <span className="text-ok">+{compare.brands.gained.join(", ")}</span> : null} {compare.brands.lost.length ? <span className="text-bad">-{compare.brands.lost.join(", ")}</span> : null}
                  {!compare.brands.gained.length && !compare.brands.lost.length ? <span className="text-muted">same</span> : null}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {compare && <p className="mt-2 text-xs text-muted">{compareText(compare, itinerary.act.name)}</p>}
    </div>
  );
}
