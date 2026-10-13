/**
 * Pre-warm the private Qloo cache for the live-mode suggestion acts, so the first visitor's plan is served from
 * memory (the rules allow private server-side caching; nothing is written to disk). Opt-in: QLOO_WARM=1 at
 * server start (src/instrumentation.ts) or POST /api/warm. Each act costs ~20 Qloo requests once per instance.
 */
import { runOnce } from "./agent/run";
import { qlooMode } from "./qloo";
import { createStore, runWithStore } from "./store";

export const WARM_BRIEFS = ["Plan a 6-city North American tour for Khruangbin starting in Austin", 'Plan a 5-city tour for "John Mulaney"', "Plan a 6-city tour for Bad Bunny"];

let warming: Promise<{ warmed: string[]; errors: string[] }> | undefined;

export function warmCache(briefs = WARM_BRIEFS): Promise<{ warmed: string[]; errors: string[] }> {
  if (qlooMode() !== "live") return Promise.resolve({ warmed: [], errors: ["not in live mode"] });
  if (warming) return warming;
  warming = (async () => {
    const warmed: string[] = [];
    const errors: string[] = [];
    for (const brief of briefs) {
      try {
        // A throwaway store: the rule planner drives the same tools, the live client keeps the responses.
        await runWithStore(createStore(), () => runOnce(brief, { unattended: true, forceMock: true }));
        warmed.push(brief);
      } catch (e) {
        errors.push(`${brief}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    warming = undefined;
    return { warmed, errors };
  })();
  return warming;
}
