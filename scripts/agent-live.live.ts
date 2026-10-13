/**
 * End-to-end agent run against the LIVE Qloo API with the keyless rule planner (no LLM key needed).
 * Prints city rankings with taste lift, the partners chosen, the counterfactual, and the Qloo call counts;
 * writes the three Devpost share links (music / comedy / counterfactual) to docs/share-links.local.md (git-ignored).
 * Names and percentages only; no raw responses are printed or written.
 *
 *   npx vitest run --config scripts/vitest.live.config.mts scripts/agent-live.live.ts --silent=false
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { runOnce } from "@/lib/agent/run";
import { getQloo, qlooMode } from "@/lib/qloo";
import type { LiveQloo } from "@/lib/qloo/live";
import { getStore, resetStore, runWithStore } from "@/lib/store";
import { buildSharePayload, sharePath } from "@/lib/tour/share";

const BRIEFS: Array<[string, string, string]> = [
  ["music", "Plan a 6-city North American tour for Khruangbin starting in Austin in March 2027", "Khruangbin"],
  ["comedy", 'Plan a 5-city tour for "John Mulaney"', "John Mulaney"],
  ["counterfactual", 'Plan a 6-city tour for "Bad Bunny"', "Bad Bunny"],
];

it("agent live run", async () => {
  if (qlooMode() !== "live") throw new Error("QLOO_API_KEY missing or QLOO_FIXTURES=1");
  const links: string[] = [`# Share links (generated ${new Date().toISOString()}, live Qloo data; not committed)\n`];
  for (const [label, brief, name] of BRIEFS) {
    const store = resetStore();
    const t0 = Date.now();
    const r = await runWithStore(store, () => runOnce(brief, { unattended: true, forceMock: true }));
    const plan = store.plan;
    console.log(`\n### ${label}: ${brief}`);
    console.log(`tools: ${r.toolCalls.join(" -> ")} (${r.steps} steps, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(`act: ${plan.act?.name} <${plan.act?.kind}> hint=${plan.act?.hint}`);
    console.log("rank | city | affinity | pop | cells | popRank | sizeRank | lift | note");
    for (const c of plan.candidates.slice(0, 15)) console.log(`${c.rank} | ${c.city} | ${(c.score * 100).toFixed(1)}% | ${(c.popularity * 100).toFixed(0)}% | ${c.cells} | ${c.popularityRank} | ${c.populationRank} | ${c.lift > 0 ? "+" : ""}${c.lift} | ${c.note ?? ""}`);
    const unscored = plan.candidates.filter((c) => c.noSignal);
    if (unscored.length) console.log(`unscored: ${unscored.map((c) => `${c.city} (${c.note})`).join("; ")}`);
    for (const s of plan.itinerary?.stops ?? []) console.log(`stop ${s.order} ${s.date} ${s.city}: venue=${s.venue?.name} [${s.venue?.detail}] ${Math.round((s.venue?.affinity ?? 0) * 100)}% | opener=${s.opener?.name} [${s.opener?.detail}] | brand=${s.brand?.name} [${s.brand?.detail}] | ex=${JSON.stringify(s.venue?.explainability?.slice(0, 2))}`);
    if (plan.compare) console.log(`compare(${plan.compare.against}): in=${plan.compare.swappedIn.map((s) => s.city).join("/")} out=${plan.compare.swappedOut.map((s) => s.city).join("/")} affinity ${plan.compare.avgAffinity.plan}->${plan.compare.avgAffinity.baseline} km ${plan.compare.totalKm.plan}->${plan.compare.totalKm.baseline}`);
    console.log(`text: ${r.text.slice(0, 600)}`);
    console.log(`calls: ${plan.calls.length} (cached ${plan.calls.filter((c) => c.cached).length}); lastError=${JSON.stringify(plan.lastError)}`);
    const payload = buildSharePayload(plan, store.policy, store.audit);
    const path = sharePath(payload);
    links.push(`## ${label} (${name})\n\n${path}\n\n(${path.length} chars)\n`);
  }
  const live = getQloo() as LiveQloo;
  console.log("\nlive stats:", live.stats);
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/share-links.local.md", links.join("\n"), "utf-8");
  console.log("wrote docs/share-links.local.md");
  void getStore;
});
