"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { StatePayload, View } from "@/lib/api";
import type { Policy } from "@/lib/policy/schema";
import type { Act } from "@/lib/tour/types";
import ActSearch from "./ActSearch";
import AgentDrawer, { type ChatMessage } from "./AgentDrawer";
import CityGrid from "./CityGrid";
import ItineraryPanel from "./ItineraryPanel";
import PartnerCards from "./PartnerCards";
import PolicyPanel from "./PolicyPanel";

const TourMap = dynamic(() => import("./TourMap"), { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-xs text-muted">loading map...</div> });

const STORAGE_KEY = "tour-router-snapshot-v1";

/** Latest snapshot for this browser tab. Module scope (not a ref) so request bodies can read it lazily. */
let latestSnapshot: unknown;

function loadSavedSnapshot(): unknown {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function saveSnapshot(snapshot: unknown) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* quota or private mode: the in-memory copy still works for this page */
  }
}

const SUGGESTIONS = ["Plan a 8-city North American tour for Nova Reyes", "Route Max Ortega through 6 cities starting in Chicago in March 2027", "Why is the first stop first?", "Skip Las Vegas"];

/**
 * The studio owns the demo state: the server is stateless between requests (serverless-safe), so the browser
 * keeps the snapshot it last received and sends it with every call. Each visitor gets an isolated plan.
 */
export default function TourStudio() {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [pending, setPending] = useState<string | undefined>();
  const [showAudit, setShowAudit] = useState(false);

  const apply = useCallback((payload: StatePayload) => {
    latestSnapshot = payload.snapshot;
    saveSnapshot(payload.snapshot);
    setView(payload.view);
  }, []);

  /** POST a state-bearing request with the current snapshot and apply the returned payload. */
  const call = useCallback(
    async (path: string, body: Record<string, unknown> = {}): Promise<string | undefined> => {
      try {
        const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, snapshot: latestSnapshot }) });
        const data = await res.json();
        if (!res.ok) return String(data.error ?? res.statusText);
        apply(data as StatePayload);
        return undefined;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [apply],
  );

  useEffect(() => {
    // Deferred so the first render does not set state synchronously inside the effect.
    const t = setTimeout(() => {
      latestSnapshot = loadSavedSnapshot();
      call("/api/state").then((e) => e && setLoadError(e));
    }, 0);
    return () => clearTimeout(t);
  }, [call]);

  const chat = useChat<ChatMessage>({
    id: "tour-router",
    transport: new DefaultChatTransport({ api: "/api/agent", body: () => ({ snapshot: latestSnapshot }) }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onData: (part) => {
      if (part.type === "data-snapshot") apply(part.data as StatePayload);
    },
  });

  const busy = chat.status === "streaming" || chat.status === "submitted";
  const ask = useCallback(
    (prompt: string) => {
      if (busy) return;
      chat.sendMessage({ text: prompt });
    },
    [chat, busy],
  );

  const pickAct = useCallback(async (act: Act) => void (await call("/api/act", { act })), [call]);
  const onExclude = useCallback((city: string, excluded: boolean) => void call("/api/plan", { op: "exclude", city, excluded }), [call]);
  const onReorder = useCallback((cities: string[]) => void call("/api/plan", { op: "rebuild", cities, keepOrder: true }), [call]);
  const onReroute = useCallback(() => {
    const cities = view?.plan.itinerary?.stops.map((s) => s.city) ?? [];
    if (cities.length) void call("/api/plan", { op: "rebuild", cities });
  }, [call, view]);
  const savePolicy = useCallback((policy: Policy) => call("/api/policy", { policy }), [call]);

  const reset = () => {
    latestSnapshot = undefined;
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    chat.setMessages([]);
    void call("/api/state");
  };

  if (!view) {
    return <div className="p-6 text-sm text-muted">{loadError ? `Could not load: ${loadError}` : "Loading Tour Router..."}</div>;
  }

  const { plan, policy } = view;
  const partnersFor = Object.keys(plan.partners);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <div>
          <div className="text-lg font-bold tracking-tight">Tour Router</div>
          <div className="text-[11px] text-muted">Route a tour by taste. Qloo says where the fans are; the agent does the rest, inside your policy.</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className={`chip ${view.mode === "live" ? "border-green-400 text-ok" : "border-amber-400 text-warn"}`} title={view.mode === "live" ? "Live Qloo hackathon API" : "No QLOO_API_KEY: synthetic fixtures, deterministic, not Qloo data"}>
            data: {view.mode === "live" ? "Qloo live" : "synthetic fixtures"}
          </span>
          <span className="chip" title="LLM in use; with no key the rule planner drives the same tools">
            llm: {view.llm}
          </span>
          <button className="btn" onClick={() => setShowPolicy(true)}>
            Policy
          </button>
          <button className="btn" onClick={() => setShowAudit(!showAudit)}>
            Audit ({view.audit.length})
          </button>
          <button className="btn" onClick={reset}>
            Reset
          </button>
        </div>
      </header>

      <div className="grid flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        <main className="flex min-w-0 flex-col gap-3">
          <ActSearch act={plan.act} mode={view.mode} onPick={pickAct} onPlan={(p) => setPending(p)} />
          <CityGrid candidates={plan.candidates} itinerary={plan.itinerary} partnersFor={partnersFor} onExclude={onExclude} onReorder={onReorder} onAsk={ask} />
          <div className="card h-[380px]">
            <div className="mb-2 flex items-center gap-2">
              <div className="text-sm font-semibold">4. Map</div>
              <span className="text-xs text-muted">blue = candidate (size = affinity), amber = routed, grey = excluded. OpenStreetMap tiles.</span>
            </div>
            <div className="h-[330px]">
              <TourMap candidates={plan.candidates} itinerary={plan.itinerary} />
            </div>
          </div>
          <PartnerCards partners={plan.partners} itinerary={plan.itinerary} />
          <ItineraryPanel itinerary={plan.itinerary} onReroute={onReroute} />
          {showAudit && (
            <div className="card">
              <div className="text-sm font-semibold">Audit</div>
              <ul className="mt-2 max-h-80 divide-y divide-border overflow-y-auto text-xs">
                {view.audit.map((a) => (
                  <li key={a.id} className="flex gap-2 py-1">
                    <span className="w-14 shrink-0 font-mono text-[10px] text-muted">{a.ts.slice(11, 19)}</span>
                    <span className={`w-16 shrink-0 ${a.decision === "denied" || a.decision === "error" ? "text-bad" : a.decision === "approval-required" ? "text-warn" : a.decision === "approved" ? "text-ok" : "text-muted"}`}>{a.decision}</span>
                    <span className="w-14 shrink-0 text-muted">{a.actor}</span>
                    <span className="min-w-0 flex-1">
                      {a.action}
                      {a.reason ? <span className="text-muted"> - {a.reason}</span> : null}
                      {a.rule ? <span className="ml-1 font-mono text-[10px] text-muted">[{a.rule}]</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
        <aside className="card h-[calc(100vh-80px)] min-h-[520px] p-0 lg:sticky lg:top-3">
          <AgentDrawer chat={chat} llm={view.llm} suggestions={SUGGESTIONS} pending={pending} />
        </aside>
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11px] text-muted">
        Built for the Qloo Agentic Hackathon. Taste data by <a className="underline" href="https://docs.qloo.com" target="_blank" rel="noreferrer">Qloo</a>; map tiles by OpenStreetMap contributors. {view.mode === "fixture" ? "This session runs on synthetic fixtures: no value shown here is Qloo data." : "Live Qloo responses are cached privately on the server and never stored in the repository."}
      </footer>

      {showPolicy && <PolicyPanel policy={policy} onSave={savePolicy} onClose={() => setShowPolicy(false)} />}
    </div>
  );
}
