"use client";

import { useState } from "react";
import type { HeldVenue } from "@/lib/policy/schema";
import type { CityPartners, Itinerary, Partner } from "@/lib/tour/types";
import { pct, usd } from "./grid";

function Explain({ p }: { p: Partner }) {
  if (!p.explainability?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {p.explainability
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((c) => (
          <span key={c.signal} className="chip text-[10px]" title={`Qloo explainability: contribution of signal ${c.signal}`}>
            {c.label ?? c.signal.split(":").slice(-1)[0]} {pct(c.score)}
          </span>
        ))}
    </div>
  );
}

function PartnerLine({ p, tag }: { p: Partner; tag: string }) {
  return (
    <li className="py-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>
          <span className="mr-1 rounded bg-background px-1 text-[10px] uppercase tracking-wide text-muted">{tag}</span>
          {p.held && <span className="mr-1 rounded bg-amber-500 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">HELD</span>}
          <span className="font-medium">{p.name}</span>
          {p.detail && <span className="ml-1 text-xs text-muted">({p.detail}{p.estimatedCostUsd ? `, est. ${usd(p.estimatedCostUsd)}` : ""})</span>}
        </span>
        <span className="tabular-nums text-xs text-muted">{p.held && !p.affinity ? "no Qloo score" : pct(p.affinity)}</span>
      </div>
      <Explain p={p} />
    </li>
  );
}

function CityCard({ p, stop, hold }: { p: CityPartners; stop?: number; hold?: HeldVenue }) {
  const [more, setMore] = useState(false);
  return (
    <div className="card" data-city-card={p.city}>
      <div className="flex items-center gap-2">
        {stop && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{stop}</span>}
        <div className="text-sm font-semibold">{p.city}</div>
        {hold && (
          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white" title="Promoter hold from the policy: this stop is pinned to this venue and date">
            HELD {hold.date}
          </span>
        )}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted">{p.mode === "live" ? "Qloo insights" : "synthetic fixture"}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{p.why}</p>
      {hold && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Held venue: {hold.venue} on {hold.date} (your input, not a Qloo result; the Qloo venue below is what the fans over-index on).</p>}
      <ul className="mt-2 divide-y divide-border">
        {p.recommendedVenue && <PartnerLine p={p.recommendedVenue} tag="venue" />}
        {p.openers[0] && <PartnerLine p={p.openers[0]} tag="opener" />}
        {p.brands[0] && <PartnerLine p={p.brands[0]} tag="brand" />}
        {more && p.venues.filter((v) => v.entity_id !== p.recommendedVenue?.entity_id).slice(0, 3).map((v) => <PartnerLine key={v.entity_id} p={v} tag="venue alt" />)}
        {more && p.openers.slice(1, 3).map((o) => <PartnerLine key={o.entity_id} p={o} tag="opener alt" />)}
        {more && p.brands.slice(1, 3).map((b) => <PartnerLine key={b.entity_id} p={b} tag="brand alt" />)}
      </ul>
      <button className="mt-1 text-xs text-accent underline" onClick={() => setMore(!more)}>
        {more ? "fewer" : "more options"}
      </button>
    </div>
  );
}

export default function PartnerCards({ partners, itinerary, holds = [] }: { partners: Record<string, CityPartners>; itinerary?: Itinerary; holds?: HeldVenue[] }) {
  const list = Object.values(partners);
  if (list.length === 0) {
    return (
      <div className="card text-sm text-muted">
        <div className="text-sm font-semibold text-foreground">3. Partners per city</div>
        <p className="mt-1">Once cities are ranked, the agent asks Qloo for the venues, brands and opening acts whose audiences overlap the act&apos;s, with explainability for each.</p>
      </div>
    );
  }
  const stopOf = new Map(itinerary?.stops.map((s) => [s.city, s.order]) ?? []);
  const sorted = list.slice().sort((a, b) => (stopOf.get(a.city) ?? 999) - (stopOf.get(b.city) ?? 999) || a.city.localeCompare(b.city));
  return (
    <div>
      <div className="mb-2 text-sm font-semibold">3. Partners per city</div>
      <div className="grid gap-3 md:grid-cols-2">
        {sorted.map((p) => (
          <CityCard key={p.city} p={p} stop={stopOf.get(p.city)} hold={holds.find((h) => h.city.toLowerCase() === p.city.toLowerCase())} />
        ))}
      </div>
    </div>
  );
}
