/**
 * State model.
 *
 * Serverless-safe: the browser carries a snapshot (policy, plan, audit log) and sends it with every request;
 * the route hydrates it into an AsyncLocalStorage context for that request and returns the new snapshot.
 * No database, every visitor gets an isolated plan, and the hosted demo cannot drift between instances.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { qlooMode } from "./qloo";
import { DEFAULT_POLICY, parsePolicy, type Policy } from "./policy/schema";
import { emptyPlan, type Plan } from "./tour/types";

export interface AuditEntry {
  id: string;
  ts: string;
  actor: "agent" | "policy" | "user" | "system";
  tool: string;
  action: string;
  decision: "allowed" | "approved" | "approval-required" | "denied" | "error" | "info";
  reason?: string;
  rule?: string;
  input?: unknown;
  output?: unknown;
}

export interface Store {
  policy: Policy;
  plan: Plan;
  audit: AuditEntry[];
  version: number;
  createdAt: string;
}

declare global {
  var __tourRouterStore: Store | undefined;
}

const als = new AsyncLocalStorage<Store>();

export function createStore(now = new Date(), policy?: Policy): Store {
  return {
    policy: policy ? structuredClone(policy) : structuredClone(DEFAULT_POLICY),
    plan: emptyPlan(qlooMode()),
    audit: [{ id: "a0", ts: now.toISOString(), actor: "system", tool: "-", action: `Session started (${qlooMode() === "live" ? "live Qloo" : "synthetic fixtures"})`, decision: "info" }],
    version: 0,
    createdAt: now.toISOString(),
  };
}

export function getStore(): Store {
  const s = als.getStore();
  if (s) return s;
  if (!globalThis.__tourRouterStore) globalThis.__tourRouterStore = createStore();
  return globalThis.__tourRouterStore;
}

export function runWithStore<T>(store: Store, fn: () => T): T {
  return als.run(store, fn);
}

export function resetStore(now = new Date()): Store {
  const s = createStore(now);
  globalThis.__tourRouterStore = s;
  return s;
}

/** Accept a snapshot from the browser; anything malformed falls back to a fresh store. */
export function hydrateSnapshot(raw: unknown): Store {
  const s = raw && typeof raw === "object" ? (raw as Partial<Store>) : {};
  const fresh = createStore();
  let policy = fresh.policy;
  try {
    policy = parsePolicy(s.policy);
  } catch {
    /* keep defaults */
  }
  const plan = s.plan && typeof s.plan === "object" ? (s.plan as Plan) : fresh.plan;
  // The data mode is a server fact; never trust the snapshot's claim.
  plan.mode = qlooMode();
  plan.candidates = Array.isArray(plan.candidates) ? plan.candidates : [];
  plan.partners = plan.partners && typeof plan.partners === "object" ? plan.partners : {};
  return { policy, plan, audit: Array.isArray(s.audit) ? s.audit.slice(0, 500) : fresh.audit, version: typeof s.version === "number" ? s.version : 0, createdAt: typeof s.createdAt === "string" ? s.createdAt : fresh.createdAt };
}

let seq = 0;

export function audit(entry: Omit<AuditEntry, "id" | "ts">): AuditEntry {
  const store = getStore();
  const e: AuditEntry = { id: `a${Date.now().toString(36)}${(++seq).toString(36)}`, ts: new Date().toISOString(), ...entry };
  store.audit.unshift(e);
  if (store.audit.length > 500) store.audit.length = 500;
  store.version++;
  return e;
}

export function touch() {
  getStore().version++;
}
