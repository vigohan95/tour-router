"use client";

import type { Act, Audience } from "@/lib/tour/types";

const signed = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;

function Bar({ label, value }: { label: string; value: number }) {
  const w = Math.min(100, Math.abs(value) * 100);
  return (
    <div className="flex items-center gap-2 text-xs" title={`Qloo demographics: ${label} ${value.toFixed(2)} (over/under-index from -1 to +1)`}>
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded bg-border">
        <div className="absolute inset-y-0 left-1/2 w-px bg-muted/60" />
        <div className={`absolute inset-y-0 ${value >= 0 ? "left-1/2 bg-accent" : "right-1/2 bg-sky-400"}`} style={{ width: `${w / 2}%` }} />
      </div>
      <span className={`w-12 shrink-0 text-right tabular-nums ${value > 0 ? "text-ok" : value < 0 ? "text-bad" : "text-muted"}`}>{signed(value)}</span>
    </div>
  );
}

/** Small audience card from one urn:demographics call. Over/under-index per bucket; not shares, not counts. */
export default function AudienceCard({ act, audience }: { act: Act; audience: Audience }) {
  return (
    <div className="card" data-panel="audience">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">1b. Audience ({audience.mode === "live" ? "Qloo demographics" : "synthetic fixture"})</div>
        <span className="text-xs text-muted">{audience.summary}</span>
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-[1fr_200px]">
        <div className="space-y-1">
          {audience.age.map((b) => (
            <Bar key={b.bucket} label={b.label} value={b.value} />
          ))}
        </div>
        <div className="space-y-1">
          {audience.gender.map((b) => (
            <Bar key={b.bucket} label={b.label} value={b.value} />
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        <code>filter.type=urn:demographics</code> with {act.name} as the signal: each bar is Qloo&apos;s over/under-index for that bucket (-1 to +1, centre line = 0). It says which groups index above or below baseline for the act; it is not an audience share, not a count and not a ticket forecast, and it does not feed the routing.
      </p>
    </div>
  );
}
