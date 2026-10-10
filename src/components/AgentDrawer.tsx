"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";

/** Chat messages carry a transient `data-snapshot` part with the updated studio state. */
export type ChatMessage = UIMessage<unknown, { snapshot: unknown }>;
type Helpers = Pick<UseChatHelpers<ChatMessage>, "messages" | "sendMessage" | "status" | "error" | "addToolApprovalResponse" | "stop" | "setMessages">;

const HUMAN: Record<string, string> = {
  resolve_artist: "Resolve act",
  rank_cities_by_affinity: "Rank cities",
  pick_city_partners: "Find partners",
  build_itinerary: "Build itinerary",
  explain_choice: "Explain",
  exclude_city: "Exclude city",
};

const human = (name: string) => HUMAN[name] ?? name.replaceAll("_", " ");

function describeInput(tool: string, input: unknown): { title: string; lines: string[] } {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  switch (tool) {
    case "build_itinerary": {
      const cities = Array.isArray(i.cities) ? (i.cities as string[]) : [];
      return { title: `Build a ${cities.length}-stop itinerary`, lines: [cities.join(" -> "), i.startCity ? `Start in ${String(i.startCity)}` : "", i.startDate ? `From ${String(i.startDate)}` : ""].filter(Boolean) };
    }
    case "pick_city_partners":
      return { title: `Find partners in ${String(i.city ?? "")}`, lines: [] };
    default:
      return { title: human(tool), lines: [JSON.stringify(input).slice(0, 300)] };
  }
}

function ApprovalCard({ tool, input, reason, onDecide }: { tool: string; input: unknown; reason?: string; onDecide: (approved: boolean) => void }) {
  const d = describeInput(tool, input);
  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-500 dark:bg-amber-950/30">
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Approval needed</span>
        <span className="font-semibold">{d.title}</span>
      </div>
      {reason && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Policy: {reason}</p>}
      {d.lines.length > 0 && (
        <div className="mt-2 space-y-1 whitespace-pre-wrap rounded bg-panel p-2 text-xs">
          {d.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <button className="btn btn-primary" onClick={() => onDecide(true)}>
          Approve
        </button>
        <button className="btn" onClick={() => onDecide(false)}>
          Deny
        </button>
      </div>
    </div>
  );
}

function ToolChip({ name, state, input, output, errorText, byYou }: { name: string; state: string; input: unknown; output: unknown; errorText?: string; byYou?: boolean }) {
  const [open, setOpen] = useState(false);
  const outObj = output && typeof output === "object" ? (output as Record<string, unknown>) : undefined;
  const failed = state === "output-error" || !!outObj?.error;
  const denied = state === "output-denied";
  const icon = failed ? "x" : denied ? "-" : state === "output-available" ? "ok" : "...";
  const tone = failed ? "border-red-300 text-bad" : denied ? "border-slate-300 text-muted line-through" : state === "output-available" ? "border-green-300 text-ok" : "border-border text-muted";
  const label = name === "pick_city_partners" && input && typeof input === "object" ? `${human(name)}: ${String((input as { city?: string }).city ?? "")}` : human(name);
  return (
    <div className="text-xs">
      <button className={`chip ${tone}`} onClick={() => setOpen(!open)} title={state}>
        <span className="font-mono text-[10px]">{icon}</span> {label}
      </button>
      {denied && <span className={`ml-2 ${byYou ? "text-bad" : "text-muted"}`}>{byYou ? "denied by you" : "blocked by policy"}</span>}
      {outObj?.error ? <span className="ml-2 text-bad">{String(outObj.error)}</span> : null}
      {open && (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 font-mono text-[10px]">
          {`input: ${JSON.stringify(input, null, 1)}\n`}
          {output !== undefined ? `output: ${JSON.stringify(output, null, 1)}` : errorText ? `error: ${errorText}` : ""}
        </pre>
      )}
    </div>
  );
}

export default function AgentDrawer({ chat, llm, suggestions, pending }: { chat: Helpers; llm: string; suggestions: string[]; pending?: string }) {
  const { messages, sendMessage, status, error, addToolApprovalResponse, stop, setMessages } = chat;
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const busy = status === "streaming" || status === "submitted";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Prefill from the studio ("Plan this act"): derived state, no effect.
  const [seenPending, setSeenPending] = useState(pending);
  if (pending !== seenPending) {
    setSeenPending(pending);
    if (pending) setInput(pending);
  }

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <div className="text-sm font-semibold">Agent</div>
          <div className="text-[11px] text-muted">model: {llm}</div>
        </div>
        <div className="flex gap-1">
          {busy && (
            <button className="btn" onClick={stop}>
              Stop
            </button>
          )}
          {messages.length > 0 && !busy && (
            <button className="btn" onClick={() => setMessages([])}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted">
            Tell the agent which act to route and how many stops. It resolves the act on Qloo, ranks cities by fan affinity, picks a venue, an opener and a brand per city, and routes them - inside your policy, asking at the edges.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-8" : "mr-2"}>
            <div className={`rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-accent text-white" : "bg-panel border border-border"}`}>
              <div className="space-y-2">
                {m.parts.map((part, idx) => {
                  if (part.type === "text") {
                    return (
                      <div key={idx} className="prose-chat whitespace-pre-wrap">
                        {part.text}
                      </div>
                    );
                  }
                  if (isToolUIPart(part)) {
                    const name = getToolName(part);
                    if (part.state === "approval-requested") {
                      return <ApprovalCard key={idx} tool={name} input={part.input} reason={part.approval.requestReason} onDecide={(approved) => addToolApprovalResponse({ id: part.approval.id, approved, reason: approved ? "Approved in the studio" : "Denied in the studio" })} />;
                    }
                    if (part.state === "approval-responded") {
                      return (
                        <div key={idx} className="text-xs">
                          <span className="chip">{human(name)}</span> <span className={part.approval.approved ? "text-ok" : "text-bad"}>{part.approval.approved ? "approved by you" : "denied by you"}</span>
                        </div>
                      );
                    }
                    const byYou = part.state === "output-denied" && !part.approval.isAutomatic;
                    return <ToolChip key={idx} name={name} state={part.state} input={part.input} output={"output" in part ? part.output : undefined} errorText={"errorText" in part ? part.errorText : undefined} byYou={byYou} />;
                  }
                  return null;
                })}
              </div>
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted">working...</div>}
        {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-bad dark:bg-red-950/30">{error.message}</div>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button key={s} className="chip hover:border-accent hover:text-accent" onClick={() => send(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Plan a 10-city North American tour for Nova Reyes" className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
          <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
