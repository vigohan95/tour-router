"use client";

import { useState } from "react";
import { REGIONS } from "@/lib/tour/cities";
import { ISO_DATE, type HeldVenue, type Policy } from "@/lib/policy/schema";

/** "City; Venue; yyyy-mm-dd" per line. */
export function parseHeldVenues(text: string): { holds: HeldVenue[]; error?: string } {
  const holds: HeldVenue[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[;|]\s*/);
    if (parts.length !== 3 || !ISO_DATE.test(parts[2])) return { holds, error: `Held venue "${line}": write it as City; Venue; yyyy-mm-dd` };
    holds.push({ city: parts[0], venue: parts[1], date: parts[2] });
  }
  return { holds };
}

export function parseDateList(text: string): { dates: string[]; error?: string } {
  const dates = text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const bad = dates.find((d) => !ISO_DATE.test(d));
  return bad ? { dates, error: `Blackout date "${bad}" must be yyyy-mm-dd` } : { dates };
}

const field = "rounded border border-border bg-background px-2 py-1";

export default function PolicyPanel({ policy, onSave, onClose }: { policy: Policy; onSave: (p: Policy) => Promise<string | undefined>; onClose: () => void }) {
  const [draft, setDraft] = useState<Policy>(structuredClone(policy));
  const [excludeText, setExcludeText] = useState(policy.excludeCities.join(", "));
  const [blackoutText, setBlackoutText] = useState(policy.blackoutDates.join(", "));
  const [holdsText, setHoldsText] = useState(policy.heldVenues.map((h) => `${h.city}; ${h.venue}; ${h.date}`).join("\n"));
  const [maxLegText, setMaxLegText] = useState(policy.maxKmPerLeg ? String(policy.maxKmPerLeg) : "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

  // z-[1000]: above Leaflet's map panes (z-index 400-700), which otherwise paint over the modal.
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg border border-border bg-panel p-4 shadow-xl" onClick={(e) => e.stopPropagation()} data-panel="policy">
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
            <input type="number" min={1} max={40} value={draft.maxCities} onChange={(e) => setDraft({ ...draft, maxCities: num(e.target.value) })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Venue budget per city, USD (over it: asks)</span>
            <input type="number" min={0} step={1000} value={draft.budgetPerCity} onChange={(e) => setDraft({ ...draft, budgetPerCity: num(e.target.value) })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Min venue capacity</span>
            <input type="number" min={0} step={100} value={draft.venue.minCapacity} onChange={(e) => setDraft({ ...draft, venue: { ...draft.venue, minCapacity: num(e.target.value) } })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Max venue capacity</span>
            <input type="number" min={0} step={100} value={draft.venue.maxCapacity} onChange={(e) => setDraft({ ...draft, venue: { ...draft.venue, maxCapacity: num(e.target.value) } })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Min days between shows</span>
            <input type="number" min={1} max={14} value={draft.minGapDays} onChange={(e) => setDraft({ ...draft, minGapDays: num(e.target.value) })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Itineraries</span>
            <select value={draft.approvals.itinerary} onChange={(e) => setDraft({ ...draft, approvals: { ...draft.approvals, itinerary: e.target.value as "auto" | "ask" } })} className={field}>
              <option value="auto">build without asking when inside the bounds</option>
              <option value="ask">always show me the itinerary first</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Radius clause: min km between any two stops (closer: refused)</span>
            <input type="number" min={0} step={10} value={draft.minKmBetweenStops} onChange={(e) => setDraft({ ...draft, minKmBetweenStops: num(e.target.value) })} className={field} data-field="minKmBetweenStops" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Max km per leg (blank = no cap; longer: refused)</span>
            <input type="number" min={1} step={100} value={maxLegText} onChange={(e) => setMaxLegText(e.target.value)} placeholder="e.g. 2000" className={field} data-field="maxKmPerLeg" />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-muted">Exclude cities (never routed), comma-separated</span>
            <input value={excludeText} onChange={(e) => setExcludeText(e.target.value)} placeholder="e.g. Las Vegas, Phoenix" className={field} />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-muted">Blackout dates (never show dates), yyyy-mm-dd comma-separated</span>
            <input value={blackoutText} onChange={(e) => setBlackoutText(e.target.value)} placeholder="e.g. 2027-03-05, 2027-03-06" className={field} data-field="blackoutDates" />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-muted">Held venues (the stop is pinned to that date and marked HELD), one per line: City; Venue; yyyy-mm-dd</span>
            <textarea value={holdsText} onChange={(e) => setHoldsText(e.target.value)} rows={3} placeholder={"e.g. Denver; Mission Ballroom; 2027-03-12"} className={`${field} font-mono text-xs`} data-field="heldVenues" />
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
        <p className="mt-2 text-[11px] text-muted">Holds, blackout dates and the radius clause are your inputs (your venue calendar, your contracts), not Qloo data. The router skips blackout dates, anchors held stops on their dates, and refuses a route that puts two stops inside the radius clause.</p>
        {err && <div className="mt-2 text-xs text-bad">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={async () => {
              setErr("");
              const holds = parseHeldVenues(holdsText);
              if (holds.error) return setErr(holds.error);
              const blackout = parseDateList(blackoutText);
              if (blackout.error) return setErr(blackout.error);
              const maxKmPerLeg = maxLegText.trim() === "" ? undefined : Number(maxLegText);
              if (maxKmPerLeg !== undefined && !(maxKmPerLeg > 0)) return setErr("Max km per leg must be a positive number or blank");
              setSaving(true);
              const e = await onSave({ ...draft, excludeCities: excludeText.split(",").map((s) => s.trim()).filter(Boolean), blackoutDates: blackout.dates, heldVenues: holds.holds, maxKmPerLeg });
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
