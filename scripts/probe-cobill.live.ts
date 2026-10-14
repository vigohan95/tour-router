/**
 * Co-bill measurement (live): the product's own pipeline against hackathon.api.qloo.com for one act -
 * resolve -> one heatmap per country -> partners for the routed stops -> tour opener (intersection of the per-city
 * opener lists) -> one JOINT heatmap per country (signal.interests.entities=<headliner>,<opener>) -> co-bill route
 * vs headliner-only route. Prints names, counts and percentages only; never a response body or an id.
 *
 *   PROBE_ACT=khruangbin|mulaney   (default khruangbin)   PROBE_STOPS=6
 *   npx vitest run --config scripts/vitest.live.config.mts --silent=false scripts/probe-cobill.live.ts
 */
import { it } from "vitest";
import { LiveQloo } from "@/lib/qloo/live";
import { setQloo } from "@/lib/qloo";
import { DEFAULT_POLICY } from "@/lib/policy/schema";
import { createStore, runWithStore } from "@/lib/store";
import { buildItinerary, pickPartners, pickTourOpener, rankCities, resolveArtist, setAct } from "@/lib/tour/actions";
import { compareWith } from "@/lib/tour/compare";
import { respectRadius } from "@/lib/tour/legs";

const q = new LiveQloo({ apiKey: process.env.QLOO_API_KEY!, baseUrl: process.env.QLOO_BASE_URL, concurrency: 2 });
setQloo(q);
const f1 = (n: number) => `${(n * 100).toFixed(1)}%`;
const pad = (s: string, n: number) => s.padEnd(n);

it("co-bill measurement", async () => {
  const which = process.env.PROBE_ACT ?? "khruangbin";
  const stops = Number(process.env.PROBE_STOPS ?? 6);
  const query = which === "mulaney" ? "John Mulaney" : "Khruangbin";
  const store = createStore(new Date(), DEFAULT_POLICY);
  await runWithStore(store, async () => {
    const plan = store.plan;
    const r = await resolveArtist(query, q);
    const act = r.hits[0];
    setAct(plan, act);
    console.log(`\n## ${act.name} (${act.kind}; ${act.hint})`);
    plan.candidates = await rankCities(act, store.policy, {}, q);
    const pool = plan.candidates.filter((c) => !c.noSignal && !c.excluded).map((c) => c.city);
    const chosen = respectRadius(pool, store.policy.minKmBetweenStops).slice(0, stops);
    console.log(`routed (top ${stops} by headliner affinity, radius clause ${store.policy.minKmBetweenStops} km): ${chosen.join(", ")}`);
    for (const c of chosen) await pickPartners(act, c, store.policy, plan, q);
    buildItinerary(act, plan, store.policy, { cities: chosen, startCity: chosen[0], startDate: "2027-03-01" });
    const cb = await pickTourOpener(act, plan, store.policy, {}, q);
    console.log(`\ntour opener: ${cb.opener.name} (${cb.opener.detail ?? "-"}) in ${cb.stopsAppeared}/${cb.ofStops} stops, mean ${f1(cb.meanAffinity)}; method=${cb.method}`);
    console.log(`runners-up: ${cb.alternates.map((a) => `${a.name} ${a.stopsAppeared}/${a.ofStops} ${f1(a.meanAffinity)}`).join(" | ")}`);
    console.log(`locals: ${Object.entries(cb.locals).map(([c, n]) => `${c}: ${n}`).join("; ") || "(tour opener is #1 everywhere)"}`);
    console.log(`\n| # | City | Headliner-only | Co-bill (joint) | Delta | Rank change |\n|---|---|---|---|---|---|`);
    const routed = new Set(chosen);
    const rows = [...cb.cities].sort((a, b) => a.headlinerRank - b.headlinerRank).filter((r, i) => i < 14 || routed.has(r.city));
    for (const row of rows) console.log(`| ${row.headlinerRank} | ${row.city}${routed.has(row.city) ? " *" : ""} | ${f1(row.headliner)} | ${f1(row.joint)} | ${row.delta >= 0 ? "+" : ""}${(row.delta * 100).toFixed(1)} pts | #${row.headlinerRank} -> #${row.jointRank} |`);
    const cmp = compareWith(act, plan, store.policy, "cobill");
    console.log(`\nco-bill route vs headliner-only route (same ${stops} stops, same start, same dates):`);
    console.log(`  co-bill route would add: ${cmp.swappedOut.map((s) => s.city).join(", ") || "nothing"}; drop: ${cmp.swappedIn.map((s) => s.city).join(", ") || "nothing"}`);
    console.log(`  headliner affinity ${f1(cmp.avgAffinity.plan)} vs ${f1(cmp.avgAffinity.baseline)}; joint affinity ${cmp.avgJointAffinity ? `${f1(cmp.avgJointAffinity.plan)} vs ${f1(cmp.avgJointAffinity.baseline)}` : "-"}; km ${cmp.totalKm.plan} vs ${cmp.totalKm.baseline}`);
    console.log(`  co-bill route order: ${cmp.baseline.stops.map((s) => s.city).join(" -> ")}`);
    console.log(`\nQloo calls this run: ${plan.calls.length} (${plan.calls.filter((c) => c.cached).length} cached); stats: ${JSON.stringify(q.stats)}`);
    console.log(pad("", 0));
  });
});
