/**
 * Provenance sink: every Qloo request (live or fixture) is reported here with redacted parameters, and the
 * store records it on the current plan ("Qloo calls behind this plan"). Entity ids are cut to 8 characters;
 * no response body ever passes through here.
 */
import type { DataMode } from "./types";

export interface CallEvent {
  endpoint: string;
  params: Record<string, string>;
  cached: boolean;
  status?: number;
  ms?: number;
  results?: number;
  mode: DataMode;
}

const ID_LIST = /^[0-9A-Fa-f-]{20,}(,[0-9A-Fa-f-]{20,})*$/;

/** Redact entity ids (comma lists too) to their first 8 characters; leave everything else as sent. */
export function redactParams(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) out[k] = ID_LIST.test(v) || /entities$/i.test(k) ? v.split(",").map((x) => `${x.slice(0, 8)}...`).join(",") : v;
  return out;
}

export const callSink: { handler?: (c: CallEvent) => void } = {};

export function reportCall(c: CallEvent) {
  try {
    callSink.handler?.({ ...c, params: redactParams(c.params) });
  } catch {
    /* provenance must never break a request */
  }
}
