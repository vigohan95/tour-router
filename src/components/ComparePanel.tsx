"use client";

import { useState } from "react";
import { compareText } from "@/lib/tour/compare-text";
import { FIELD_LABEL, POLICY_FIELDS, type PolicyChange, type PolicyField } from "@/lib/tour/policy-compare";
import type { CompareResult, Itinerary } from "@/lib/tour/types";
import { pct } from "./grid";

const signed = (n: number, unit = "") => `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}${unit}`;
const word = (x: "allow" | "approve" | "deny") => (x === "allow" ? "allowed" : x === "approve" ? "needs approval" : "denied");
const PLACEHOLDER: Record<PolicyField, string> = { maxCities: "e.g. 8", excludeCities: "city names to add, comma-separated", minKmBetweenStops: "e.g. 300", blackoutDates: "yyyy-mm-dd, comma-separated", maxKmPerLeg: "e.g. 2000 (blank = no cap)", minGapDays: "e.g. 3" };

/** "Compare under policy B": one field of the current policy changed; the route is rebuilt from the cached ranking, no Qloo call. */
function PolicyB({ busy, onCompare }: { busy: boolean; onCompare: (change: PolicyChange) => void }) {
  const [field, setField] = useState<PolicyField>("maxCities");
  const [value, setValue] = useState("8");
  const submit = () => {
    const v = value.trim();
    if (field === "excludeCities" || field === "blackoutDates") return onCompare({ field, value: v.split(",").map((s) => s.trim()).filter(Boolean) });
    if (field === "maxKmPerLeg" && v === "") return onCompare({ field, value: null });
    onCompare({ field, value: Number(v) });
  };
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2 text-xs"
      data-panel="policy-b"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="font-semibold">Policy B:</span>
      <span className="text-muted">the same brief with one rule changed</span>
      <select value={field} onChange={(e) => { setField(e.target.value as PolicyField); setValue(""); }} className="rounded border border-border bg-background px-2 py-1">
        {POLICY_FIELDS.map((f) => (
          <option key={f} value={f}>
            {FIELD_LABEL[f]}
          </option>
        ))}
      </select>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={PLACEHOLDER[field]} className="w-56 rounded border border-border bg-background px-2 py-1" />
      <button type="submit" className="btn" disabled={busy}>
        Compare under policy B
      </button>
    </form>
  );
}

/** Counterfactual card: the taste route against the obvious (population) route, listener density, the previous route, the co-bill route, or policy B. */
export default function ComparePanel({ itinerary, compare, busy, onCompare, onComparePolicy, error }: { itinerary?: Itinerary; compare?: CompareResult; busy: boolean; onCompare: (against: CompareResult["against"]) => void; onComparePolicy?: (change: PolicyChange) => void; error?: string }) {
  if (!itinerary) return null;
  const policy = compare?.against === "policy" ? compare.policy : undefined;
  return (
    <div className="card" data-panel="compare">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">6. What did taste change? And what would another rule change?</div>
        <span className="text-xs text-muted">Same stop count, same dates, same routing; only the city choice (or the policy) differs.</span>
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
          <button className={`btn ${compare?.against === "cobill" ? "btn-primary" : ""}`} disabled={busy} onClick={() => onCompare("cobill")} title="The route a headliner + tour-opener joint heatmap would pick (picks the tour opener first if needed)">
            vs co-bill route
          </button>
        </span>
      </div>
      {onComparePolicy && <PolicyB busy={busy} onCompare={onComparePolicy} />}
      {error && <div className="mt-2 text-xs text-bad">{error}</div>}
      {!compare && <p className="mt-2 text-xs text-muted">Pick a baseline to see which cities Qloo swapped in and out, and what that cost or gained in fan affinity, travel and partners; or change one rule and see what the same brief becomes under policy B.</p>}
      {policy && (
        <div className="mt-2 rounded-md border border-border p-2 text-xs" data-section="policy-diff">
          <div className="font-semibold">
            Policy B = policy A with {policy.label} ({policy.stopsA} {"->"} {policy.stopsB} stops)
          </div>
          <ul className="mt-1 space-y-0.5">
            {policy.decisions.map((d, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-1">
                <span>{d.action}:</span>
                <span className={d.underA === "deny" ? "text-bad" : d.underA === "approve" ? "text-warn" : "text-ok"}>{word(d.underA)} under A</span>
                <span className="text-muted">,</span>
                <span className={d.underB === "deny" ? "text-bad" : d.underB === "approve" ? "text-warn" : "text-ok"}>{word(d.underB)} under B</span>
                <span className="font-mono text-[10px] text-muted">[{d.underB === "allow" ? d.ruleA : d.ruleB}]</span>
                {d.underB !== "allow" && <span className="text-muted">- {d.reasonB}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {compare && (
        <div className="mt-2 grid gap-3 text-sm md:grid-cols-[1fr_1fr_auto]">
          <div className="rounded-md border border-green-300 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ok">{compare.against === "policy" ? "Only under policy A (current route)" : compare.against === "cobill" ? "Headliner-only route keeps (co-bill would drop)" : "Taste route adds"}</div>
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
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bad">{compare.against === "previous" ? "Dropped since the previous route" : compare.against === "policy" ? "Only under policy B" : compare.against === "cobill" ? "Co-bill route would pick instead" : `${compare.against === "population" ? "The obvious route (biggest metros)" : "Listener-only routing"} would pick instead`}</div>
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
                <th className="pr-3">{compare.against === "cobill" ? "headliner route" : compare.against === "policy" ? "policy A" : "taste"}</th>
                <th className="pr-3">{compare.against === "cobill" ? "co-bill route" : compare.against === "policy" ? "policy B" : "baseline"}</th>
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
              {compare.avgJointAffinity && (
                <tr>
                  <td className="pr-3">avg co-bill affinity</td>
                  <td className="pr-3">{pct(compare.avgJointAffinity.plan)}</td>
                  <td className="pr-3">{pct(compare.avgJointAffinity.baseline)}</td>
                  <td className={compare.avgJointAffinity.delta >= 0 ? "text-ok" : "text-bad"}>{signed(Math.round(compare.avgJointAffinity.delta * 100), " pts")}</td>
                </tr>
              )}
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
