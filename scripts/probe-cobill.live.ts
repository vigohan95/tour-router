/**
 * Co-bill probe (live): does a heatmap accept TWO signal entities (headliner + opener)? Prints cell counts and the
 * top cities by binned affinity for headliner-only vs joint, plus the per-city delta. Shapes and numbers only, no bodies.
 *   PROBE_ACT=khruangbin|mulaney  (default khruangbin)
 */
import { it } from "vitest";
import { LiveQloo } from "@/lib/qloo/live";
import { CITIES } from "@/lib/tour/cities";
import { aggregateHeatmap, cellsNear } from "@/lib/tour/actions";

const q = new LiveQloo({ apiKey: process.env.QLOO_API_KEY!, baseUrl: process.env.QLOO_BASE_URL, concurrency: 2 });
type J = Record<string, any>;
const f3 = (n: number) => n.toFixed(3);

it("two-signal heatmap", async () => {
  const which = process.env.PROBE_ACT ?? "khruangbin";
  const headliner = which === "mulaney" ? { name: "John Mulaney", types: ["urn:entity:person"] as const } : { name: "Khruangbin", types: ["urn:entity:artist"] as const };
  const s = await q.search(headliner.name, [...headliner.types], 5);
  const head = s.find((h) => h.types.includes(headliner.types[0]) && (which !== "mulaney" || (h.tagIds ?? []).some((t) => /stand[- _]?up|comedian/i.test(t))))!;
  console.log("headliner:", head.name, head.types.join("/"), head.entity_id.slice(0, 8) + "...");
  // openers for Austin (same call the product makes)
  const type = which === "mulaney" ? "urn:entity:person" : "urn:entity:artist";
  const op = await q.insights({ type, signalEntities: [head.entity_id], signalLocation: { query: "Austin" }, take: which === "mulaney" ? 30 : 5, trends: "high", excludeEntities: [head.entity_id] });
  const opener = which === "mulaney" ? op.entities.find((e) => e.tags.some((t) => /stand[- _]?up|comedian/i.test(t))) ?? op.entities[0] : op.entities[0];
  console.log("opener (Austin top):", opener.name, opener.entity_id.slice(0, 8) + "...");
  const us = CITIES.filter((c) => c.country === "US");
  const single = await q.heatmap({ signalEntities: [head.entity_id], location: { query: "United States" } });
  let joint: { cells: typeof single.cells } | undefined;
  let err = "";
  try {
    joint = await q.heatmap({ signalEntities: [head.entity_id, opener.entity_id], location: { query: "United States" } });
  } catch (e) {
    err = String(e).slice(0, 200);
  }
  const openerOnly = await q.heatmap({ signalEntities: [opener.entity_id], location: { query: "United States" } });
  console.log(`cells: headliner=${single.cells.length} joint=${joint?.cells.length ?? "ERR " + err} opener-only=${openerOnly.cells.length}`);
  const raw = (joint as J | undefined)?.raw;
  console.log("joint raw keys:", raw ? Object.keys(raw) : "-", "query.signal echo:", JSON.stringify((raw as J)?.query?.signal ?? (raw as J)?.query?.interests ?? null)?.slice(0, 200));
  const score = (cells: typeof single.cells) => us.map((c) => ({ city: c.name, v: aggregateHeatmap(cellsNear(c, cells)), n: cellsNear(c, cells).length }));
  const a = score(single.cells);
  const b = joint ? score(joint.cells) : undefined;
  const o = score(openerOnly.cells);
  const avgd = a.map((r, i) => ({ city: r.city, v: r.n && o[i].n ? (r.v + o[i].v) / 2 : 0, n: Math.min(r.n, o[i].n) }));
  const rank = (rows: { city: string; v: number }[]) => new Map([...rows].sort((x, y) => y.v - x.v).map((r, i) => [r.city, i + 1]));
  const ra = rank(a), rb = b ? rank(b) : undefined, ro = rank(o), rv = rank(avgd);
  const identical = b ? a.every((r, i) => Math.abs(r.v - b![i].v) < 1e-6) : false;
  console.log("joint identical to headliner-only?", identical);
  console.log("city | headliner (rank) | joint (rank) | opener-only (rank) | avg-of-singles (rank)");
  for (const r of [...a].sort((x, y) => y.v - x.v).slice(0, 14)) {
    const i = a.findIndex((x) => x.city === r.city);
    console.log(`${r.city.padEnd(14)} ${f3(a[i].v)} (#${ra.get(r.city)})  ${b ? `${f3(b[i].v)} (#${rb!.get(r.city)})` : "-"}  ${f3(o[i].v)} (#${ro.get(r.city)})  ${f3(avgd[i].v)} (#${rv.get(r.city)})`);
  }
  console.log("stats:", q.stats);
});
