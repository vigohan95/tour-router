"use client";

import { useEffect, useRef, useState } from "react";
import type { Act } from "@/lib/tour/types";

interface Hit extends Act {
  types?: string[];
}

export default function ActSearch({ act, mode, onPick, onPlan }: { act?: Act; mode: "fixture" | "live"; onPick: (act: Act) => Promise<void>; onPlan: (prompt: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [stops, setStops] = useState(8);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!q.trim()) {
        setHits([]);
        return;
      }
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        setHits(data.hits ?? []);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">1. Act</div>
        <span className="text-[11px] text-muted">{mode === "live" ? "Qloo /search (live)" : "Qloo /search - synthetic fixture"}</span>
      </div>
      <div className="mt-2 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Musician, band, comedian, podcast..." className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
      </div>
      {err && <div className="mt-2 text-xs text-bad">{err}</div>}
      {loading && <div className="mt-2 text-xs text-muted">searching...</div>}
      {hits.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {hits.map((h) => (
            <li key={h.entity_id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{h.name}</div>
                <div className="truncate text-[11px] text-muted">
                  {h.hint ?? ""}
                  {h.popularity !== undefined ? ` - popularity ${Math.round(h.popularity * 100)}%` : ""}
                </div>
              </div>
              <button
                className={`btn ${act?.entity_id === h.entity_id ? "btn-primary" : ""}`}
                onClick={async () => {
                  await onPick(h);
                  setHits([]);
                  setQ("");
                }}
              >
                {act?.entity_id === h.entity_id ? "Selected" : "Select"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {act && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <span className="font-semibold">{act.name}</span>
          <span className="font-mono text-[10px] text-muted">{act.entity_id}</span>
          <span className="ml-auto flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              stops
              <input type="number" min={1} max={40} value={stops} onChange={(e) => setStops(Number(e.target.value) || 1)} className="w-14 rounded border border-border bg-panel px-1 py-0.5" />
            </label>
            <button className="btn btn-primary" onClick={() => onPlan(`Plan a ${stops}-city tour for "${act.name}"`)}>
              Plan tour with the agent
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
