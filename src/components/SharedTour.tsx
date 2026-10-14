"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { SharePayload, SharedPartner } from "@/lib/tour/share";
import { pct, usd } from "./grid";

const ShareMap = dynamic(() => import("./ShareMap"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-xs text-muted">loading map...</div> });

function Partner({ p, tag }: { p?: SharedPartner; tag: string }) {
  if (!p) return null;
  return (
    <div className="text-sm">
      <span className="mr-1 rounded bg-background px-1 text-[10px] uppercase tracking-wide text-muted">{tag}</span>
      {p.held && <span className="mr-1 rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">HELD</span>}
      <span className="font-medium">{p.name}</span>
      {p.detail && <span className="ml-1 text-xs text-muted">({p.detail}{p.capacity ? `, ${p.capacity.toLocaleString("en-US")} cap` : ""})</span>}
      <span className="ml-2 text-xs tabular-nums text-muted">{pct(p.affinity)}</span>
      {p.explain?.length ? (
        <span className="ml-2 inline-flex flex-wrap gap-1">
          {p.explain.map((c) => (
            <span key={c.label} className="chip text-[10px]" title="Qloo explainability: contribution of this signal to the affinity">
              {c.label} {pct(c.score)}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

const lift = (n?: number) => (n === undefined ? "" : n > 0 ? `+${n}` : String(n));

/** Read-only tour page rendered from the URL payload: no agent, no LLM, no server state. Printable (browser print = PDF). */
export default function SharedTour({ p }: { p: SharePayload }) {
  const top = p.candidates.filter((c) => !c.noSignal).slice(0, 12);
  return (
    <div className="mx-auto max-w-5xl p-4 print:max-w-none print:p-0" data-page="shared-tour">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">Tour Router - promoter brief</div>
          <h1 className="text-2xl font-bold tracking-tight">{p.act.name}</h1>
          <div className="text-sm text-muted">
            {p.stops.length} stops, {p.startDate} to {p.endDate}, {p.totalKm.toLocaleString("en-US")} km{p.estimatedCostUsd ? `, est. venues ${usd(p.estimatedCostUsd)}` : ""}. {p.act.kind === "person" ? "Comedy / person entity." : "Music / artist entity."}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className={`chip ${p.mode === "live" ? "border-green-400 text-ok" : "border-amber-400 text-warn"}`}>data: {p.mode === "live" ? "Qloo live" : "synthetic fixtures (not Qloo data)"}</span>
          <button className="btn print:hidden" onClick={() => window.print()}>
            Print brief
          </button>
          <Link className="btn print:hidden" href="/">
            Open the studio
          </Link>
        </div>
      </header>

      {p.mode === "fixture" && <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">This plan was made on synthetic fixtures: every name and score was generated from a hash. It shows the product flow, not Qloo data.</div>}

      <section className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="text-sm font-semibold">Where the fans are (Qloo heatmap, binned to cities)</h2>
          <p className="mt-1 text-xs text-muted">Affinity = mean of the strongest cells within 60 km of the city on one country-wide Qloo heatmap for the act. Listeners = Qloo popularity of the same cells. Taste lift = size rank minus taste rank.</p>
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">City</th>
                <th className="py-1 pr-2">Affinity</th>
                <th className="py-1 pr-2">Listeners</th>
                <th className="py-1 pr-2">Size #</th>
                <th className="py-1 pr-2">Lift</th>
              </tr>
            </thead>
            <tbody>
              {top.map((c) => (
                <tr key={c.city} className={`border-t border-border ${p.stops.some((s) => s.city === c.city) ? "font-semibold" : ""} ${c.excluded ? "line-through opacity-50" : ""}`}>
                  <td className="py-0.5 pr-2 tabular-nums">{c.rank}</td>
                  <td className="py-0.5 pr-2">
                    {c.city}, {c.country}
                  </td>
                  <td className="py-0.5 pr-2 tabular-nums">{(c.score * 100).toFixed(1)}%</td>
                  <td className="py-0.5 pr-2 tabular-nums">{pct(c.popularity)}</td>
                  <td className="py-0.5 pr-2 tabular-nums">{c.populationRank}</td>
                  <td className={`py-0.5 pr-2 tabular-nums ${c.lift > 0 ? "text-ok" : c.lift < 0 ? "text-bad" : "text-muted"}`}>{lift(c.lift)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="h-[320px] overflow-hidden rounded-md border border-border print:h-[280px]">
          <ShareMap stops={p.stops} baseline={p.compare?.baselineStops} />
        </div>
      </section>

      {p.compare && (
        <section className="mt-4 rounded-md border border-border p-3" data-section="compare">
          <h2 className="text-sm font-semibold">What taste changed vs {p.compare.label}</h2>
          <div className="mt-2 grid gap-3 text-sm md:grid-cols-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ok">Taste route adds</div>
              <div>{p.compare.swappedIn.join(", ") || "nothing"}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-bad">Baseline would pick instead</div>
              <div>{p.compare.swappedOut.join(", ") || "nothing"}</div>
            </div>
            <div className="text-xs tabular-nums">
              <div>
                avg fan affinity {pct(p.compare.avgAffinity.plan)} vs {pct(p.compare.avgAffinity.baseline)} ({p.compare.avgAffinity.delta >= 0 ? "+" : ""}
                {Math.round(p.compare.avgAffinity.delta * 100)} pts)
              </div>
              <div>
                travel {p.compare.totalKm.plan.toLocaleString("en-US")} km vs {p.compare.totalKm.baseline.toLocaleString("en-US")} km ({p.compare.totalKm.delta === 0 ? "same" : `${Math.abs(p.compare.totalKm.delta).toLocaleString("en-US")} km ${p.compare.totalKm.delta > 0 ? "more" : "fewer"}`})
              </div>
              {p.compare.openers.gained.length > 0 && <div>openers only taste finds: {p.compare.openers.gained.join(", ")}</div>}
              {p.compare.brands.gained.length > 0 && <div>brands only taste finds: {p.compare.brands.gained.join(", ")}</div>}
            </div>
          </div>
        </section>
      )}

      <section className="mt-4">
        <h2 className="text-sm font-semibold">Itinerary</h2>
        <ol className="mt-2 space-y-3">
          {p.stops.map((s) => (
            <li key={s.city} className="rounded-md border border-border p-3 print:break-inside-avoid" data-stop={s.order}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{s.order}</span>
                <span className="font-semibold">
                  {s.city}, {s.country}
                </span>
                <span className="text-sm text-muted">{s.date}</span>
                <span className="text-xs tabular-nums text-muted">
                  {(s.score * 100).toFixed(1)}% affinity{s.rank ? `, #${s.rank} by taste` : ""}
                  {s.populationRank ? `, #${s.populationRank} by size` : ""}
                  {s.lift !== undefined ? ` (lift ${lift(s.lift)})` : ""}
                  {s.legKm ? `, ${s.legKm.toLocaleString("en-US")} km from the previous stop` : ""}
                </span>
              </div>
              <div className="mt-1 space-y-0.5">
                <Partner p={s.venue} tag="venue" />
                <Partner p={s.opener} tag="opener" />
                <Partner p={s.brand} tag="brand" />
              </div>
              {s.why && <p className="mt-1 text-xs text-muted">{s.why}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-4 grid gap-4 text-xs md:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold">Policy the agent worked inside</h2>
          <ul className="mt-1 text-muted">
            <li>max cities {p.policy.maxCities}; budget per city {usd(p.policy.budgetPerCity)}; capacity window {p.policy.venue.minCapacity.toLocaleString("en-US")}-{p.policy.venue.maxCapacity.toLocaleString("en-US")}; min gap {p.policy.minGapDays} days</li>
            {p.policy.minKmBetweenStops !== undefined && <li>radius clause: no two stops within {p.policy.minKmBetweenStops} km{p.policy.maxKmPerLeg ? `; max ${p.policy.maxKmPerLeg.toLocaleString("en-US")} km per leg` : ""}</li>}
            {p.policy.blackoutDates?.length ? <li>blackout dates: {p.policy.blackoutDates.join(", ")}</li> : null}
            {p.policy.heldVenues?.length ? <li>held: {p.policy.heldVenues.map((h) => `${h.city} - ${h.venue} (${h.date})`).join("; ")}</li> : null}
            <li>regions: {p.policy.regions.join(", ") || "anywhere"}</li>
            <li>excluded: {p.policy.excludeCities.join(", ") || "none"}</li>
          </ul>
          <h2 className="mt-3 text-sm font-semibold">Decisions</h2>
          <div className="mt-1 text-muted">
            {p.audit.allowed} allowed, {p.audit.approved} approved by the promoter, {p.audit.approvalRequired} asked, {p.audit.denied} denied, {p.audit.errors} errors
          </div>
          <ul className="mt-1 text-muted">
            {p.audit.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Qloo calls behind this plan</h2>
          <div className="mt-1 text-muted">
            {p.qloo.calls} requests, {p.qloo.cached} from the private server cache
          </div>
          <ul className="mt-1 font-mono text-[11px] text-muted">
            {p.qloo.endpoints.map((e) => (
              <li key={`${e.endpoint}|${e.type}`}>
                GET {e.endpoint} {e.type} x{e.n}
              </li>
            ))}
          </ul>
          <h2 className="mt-3 text-sm font-semibold">What this does not establish</h2>
          <p className="mt-1 text-muted">Affinity is a taste over-index, not a ticket forecast; listener density is not attendance; venues have no capacity or price in Qloo place data, so the capacity window only applies where a figure exists; nothing here checks venue availability or holds. Generated {p.generatedAt.slice(0, 10)}.</p>
        </div>
      </section>
    </div>
  );
}
