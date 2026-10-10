/**
 * Adapter selection. One process-wide instance so the live client's private cache survives across requests
 * on the same server instance (Vercel keeps warm instances around; the rules allow private caching).
 *
 *   QLOO_API_KEY set and QLOO_FIXTURES != "1"  -> LiveQloo (hackathon.api.qloo.com)
 *   otherwise                                  -> FixtureQloo (synthetic, no network)
 */
import { FixtureQloo } from "./fixture";
import { LiveQloo } from "./live";
import type { DataMode, QlooAdapter } from "./types";

declare global {
  var __tourRouterQloo: { key: string; adapter: QlooAdapter } | undefined;
}

export function qlooMode(): DataMode {
  if (process.env.QLOO_FIXTURES === "1") return "fixture";
  return process.env.QLOO_API_KEY ? "live" : "fixture";
}

export function getQloo(): QlooAdapter {
  const mode = qlooMode();
  const key = mode === "live" ? `live:${process.env.QLOO_BASE_URL ?? ""}:${process.env.QLOO_API_KEY}` : "fixture";
  const current = globalThis.__tourRouterQloo;
  if (current && (current.key === key || current.key.startsWith("injected:"))) return current.adapter;
  const adapter: QlooAdapter = mode === "live" ? new LiveQloo({ apiKey: process.env.QLOO_API_KEY!, baseUrl: process.env.QLOO_BASE_URL }) : new FixtureQloo();
  globalThis.__tourRouterQloo = { key, adapter };
  return adapter;
}

/** Tests and the agent runner can inject an adapter. */
export function setQloo(adapter: QlooAdapter | undefined) {
  globalThis.__tourRouterQloo = adapter ? { key: `injected:${adapter.mode}`, adapter } : undefined;
}

export * from "./types";
