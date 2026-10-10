/**
 * Route-handler helpers for the client-carried state model (see store.ts).
 */
import { llmLabel } from "./llm";
import { qlooMode } from "./qloo";
import type { Policy } from "./policy/schema";
import type { Plan } from "./tour/types";
import { getStore, hydrateSnapshot, runWithStore, type AuditEntry, type Store } from "./store";

export type Body = Record<string, unknown>;

export interface View {
  policy: Policy;
  plan: Plan;
  audit: AuditEntry[];
  version: number;
  mode: "fixture" | "live";
  llm: string;
}

export interface StatePayload {
  view: View;
  snapshot: Store;
}

export async function readBody(req: Request): Promise<Body> {
  try {
    const text = await req.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Body) : {};
  } catch {
    return {};
  }
}

/** Hydrate `body.snapshot` (or a fresh Store) for this request and run `fn` inside it. */
export function withSnapshot<T>(body: Body, fn: (store: Store) => T): T {
  const store = hydrateSnapshot(body.snapshot);
  return runWithStore(store, () => fn(store));
}

/** The UI view + the snapshot the client must send back next time. Must run inside a Store context. */
export function statePayload(): StatePayload {
  const store = getStore();
  return { view: { policy: store.policy, plan: store.plan, audit: store.audit, version: store.version, mode: qlooMode(), llm: llmLabel() }, snapshot: store };
}

export function stateResponse(extra: Record<string, unknown> = {}): Response {
  return Response.json({ ...statePayload(), ...extra });
}

export function errorResponse(e: unknown, status = 400): Response {
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
}
