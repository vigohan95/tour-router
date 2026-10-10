"use client";

import { useState } from "react";
import { REGIONS } from "@/lib/tour/cities";
import type { Policy } from "@/lib/policy/schema";

export default function PolicyPanel({ policy, onSave, onClose }: { policy: Policy; onSave: (p: Policy) => Promise<string | undefined>; onClose: () => void }) {
  const [draft, setDraft] = useState<Policy>(structuredClone(policy));
  const [excludeText, setExcludeText] = useState(policy.excludeCities.join(", "));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg border border-border bg-panel p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold">Routing policy</div>
            <div className="text-xs text-muted">What the agent may do alone, where it asks you, and what it may never do. Every decision cites one of these fields.</div>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Max cities per itinerary (over it: asks)</span>
            <input type="number" min={1} max={40} value={draft.maxCities} onChange={(e) => setDraft({ ...draft, maxCities: num(e.target.value) })} className="rounded border border-border bg-background px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Venue budget per city, USD (over it: asks)</span>
            <input type="number" min={0} step={1000} value={draft.budgetPerCity} onChange={(e) => setDraft({ ...draft, budgetPerCity: num(e.target.value) })} className="rounded border border-border bg-background px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Min venue capacity</span>
            <input type="number" min={0} step={100} value={draft.venue.minCapacity} onChange={(e) => setDraft({ ...draft, venue: { ...draft.venue, minCapacity: num(e.target.value) } })} className="rounded border border-border bg-background px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Max venue capacity</span>
            <input type="number" min={0} step={100} value={draft.venue.maxCapacity} onChange={(e) => setDraft({ ...draft, venue: { ...draft.venue, maxCapacity: num(e.target.value) } })} className="rounded border border-border bg-background px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Min days between shows</span>
            <input type="number" min={1} max={14} value={draft.minGapDays} onChange={(e) => setDraft({ ...draft, minGapDays: num(e.target.value) })} className="rounded border border-border bg-background px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Itineraries</span>
            <select value={draft.approvals.itinerary} onChange={(e) => setDraft({ ...draft, approvals: { ...draft.approvals, itinerary: e.target.value as "auto" | "ask" } })} className="rounded border border-border bg-background px-2 py-1">
              <option value="auto">build without asking when inside the bounds</option>
              <option value="ask">always show me the itinerary first</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-muted">Exclude cities (never routed), comma-separated</span>
            <input value={excludeText} onChange={(e) => setExcludeText(e.target.value)} placeholder="e.g. Las Vegas, Phoenix" className="rounded border border-border bg-background px-2 py-1" />
          </label>
          <div className="sm:col-span-2">
            <span className="text-xs text-muted">Regions the agent may plan in (none = anywhere)</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {REGIONS.map((r) => {
                const on = draft.regions.includes(r);
                return (
                  <button key={r} className={`chip ${on ? "border-accent bg-accent text-white" : ""}`} onClick={() => setDraft({ ...draft, regions: on ? draft.regions.filter((x) => x !== r) : [...draft.regions, r] })}>
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {err && <div className="mt-2 text-xs text-bad">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setErr("");
              const e = await onSave({ ...draft, excludeCities: excludeText.split(",").map((s) => s.trim()).filter(Boolean) });
              setSaving(false);
              if (e) setErr(e);
              else onClose();
            }}
          >
            Save policy
          </button>
        </div>
      </div>
    </div>
  );
}
