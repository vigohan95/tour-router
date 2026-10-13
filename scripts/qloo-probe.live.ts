/**
* Live probe for the Qloo hackathon API (run: PROBE_STEP=search npx vitest run --config scripts/vitest.live.config.mts).
 * Prints SHAPES (key paths, types, counts) and a few redacted values; never the key, never a full response.
 */
import { it } from "vitest";
import { LiveQloo } from "@/lib/qloo/live";

const key = process.env.QLOO_API_KEY;
if (!key) throw new Error("QLOO_API_KEY missing");
const q = new LiveQloo({ apiKey: key, baseUrl: process.env.QLOO_BASE_URL, concurrency: 2 });

function shape(v: unknown, depth = 0, maxDepth = 4, path = ""): string[] {
  const out: string[] = [];
  if (depth > maxDepth) return out;
  if (Array.isArray(v)) {
    out.push(`${path}: array[${v.length}]`);
    if (v.length) out.push(...shape(v[0], depth + 1, maxDepth, path + "[0]"));
  } else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (val && typeof val === "object") out.push(...shape(val, depth + 1, maxDepth, p));
      else out.push(`${p}: ${typeof val}${typeof val === "number" ? `=${val}` : typeof val === "boolean" ? `=${val}` : typeof val === "string" && (k === "type" || k === "subtype" || k.endsWith("_id") || k === "id" || k === "name" || k === "tag_id") ? `=${String(val).slice(0, 60)}` : ""}`);
    }
  } else out.push(`${path}: ${typeof v}`);
  return out;
}
const show = (label: string, v: unknown, maxDepth = 4) => {
  console.log(`\n=== ${label}`);
  for (const l of shape(v, 0, maxDepth)) console.log("  " + l);
};
const step = process.env.PROBE_STEP ?? "all";
async function main() {
  if (step === "all" || step === "search") {
    for (const [name, types] of [["Taylor Swift", "urn:entity:artist"], ["Khruangbin", "urn:entity:artist"], ["John Mulaney", "urn:entity:artist"], ["John Mulaney", "urn:entity:person"], ["Bad Bunny", "urn:entity:artist"]] as const) {
      try {
        const raw = await q.get("/search", { query: name, types, take: "3" });
        show(`/search ${name} ${types}`, raw, 3);
        const hits = await q.search(name, [types as never], 3);
        console.log("  parsed:", hits.map((h) => `${h.name} | ${h.entity_id.slice(0, 8)}.. | pop=${h.popularity} | hint=${h.hint?.slice(0, 50)} | types=${h.types.join(",")}`));
      } catch (e) { console.log("  ERR", String(e).slice(0, 300)); }
    }
  }
  const hits = await q.search("Khruangbin", ["urn:entity:artist"], 1);
  const act = hits[0]?.entity_id;
  console.log("\nact id prefix:", act?.slice(0, 8), "name:", hits[0]?.name);
  if (!act) return;
  if (step === "all" || step === "place") {
    try {
      const raw = await q.get("/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": act, "filter.location.query": "Austin", "filter.tags": "urn:tag:genre:place:music_venue", take: "5", "feature.explainability": "true" });
      show("insights place+music_venue Austin", raw, 6);
      const r = await q.insights({ type: "urn:entity:place", signalEntities: [act], location: { query: "Austin" }, tags: ["urn:tag:genre:place:music_venue"], take: 5, explainability: true });
      console.log("  parsed:", r.entities.map((e) => `${e.name} aff=${e.affinity} pop=${e.popularity} sub=${e.subtype} geo=${!!e.geo} addr=${!!e.address} cap=${e.properties.capacity} tags=${e.tags.length} ex=${JSON.stringify(e.explainability)?.slice(0, 120)}`));
    } catch (e) { console.log("  ERR", String(e).slice(0, 400)); }
    try {
      const raw = await q.get("/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": act, "filter.location.query": "Austin", take: "3" });
      show("insights place (no tag) Austin", raw, 5);
    } catch (e) { console.log("  ERR", String(e).slice(0, 400)); }
  }
  if (step === "all" || step === "brand") {
    try {
      const raw = await q.get("/v2/insights", { "filter.type": "urn:entity:brand", "signal.interests.entities": act, "filter.location.query": "Austin", take: "5", "feature.explainability": "true" });
      show("insights brand Austin", raw, 6);
      const r = await q.insights({ type: "urn:entity:brand", signalEntities: [act], location: { query: "Austin" }, take: 5, explainability: true });
      console.log("  parsed:", r.entities.map((e) => `${e.name} aff=${e.affinity} sub=${e.subtype} tags=${e.tags.slice(0, 3).join("|")} ex=${JSON.stringify(e.explainability)?.slice(0, 100)}`));
    } catch (e) { console.log("  ERR", String(e).slice(0, 400)); }
  }
  if (step === "all" || step === "artist") {
    try {
      const raw = await q.get("/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": act, "filter.location.query": "Austin", take: "5", "feature.explainability": "true", "bias.trends": "high", "filter.exclude.entities": act });
      show("insights artist openers Austin", raw, 6);
      const r = await q.insights({ type: "urn:entity:artist", signalEntities: [act], location: { query: "Austin" }, take: 5, explainability: true, trends: "high", excludeEntities: [act] });
      console.log("  parsed:", r.entities.map((e) => `${e.name} aff=${e.affinity} sub=${e.subtype} tags=${e.tags.slice(0, 3).join("|")} ex=${JSON.stringify(e.explainability)?.slice(0, 100)}`));
    } catch (e) { console.log("  ERR", String(e).slice(0, 400)); }
  }
  if (step === "all" || step === "heatmap") {
    try {
      const raw = await q.get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": act, "filter.location.query": "Austin", take: "50" });
      show("heatmap Austin", raw, 5);
      const r = await q.heatmap({ signalEntities: [act], location: { query: "Austin" }, take: 50 });
      console.log("  parsed cells:", r.cells.length, r.cells.slice(0, 3));
    } catch (e) { console.log("  ERR", String(e).slice(0, 400)); }
  }
  if (step === "all" || step === "locality") {
    try {
      const raw = await q.get("/v2/insights", { "filter.type": "urn:entity:locality", "signal.interests.entities": act, take: "50" });
      show("insights locality (no location)", raw, 5);
      const ents = ((raw as any)?.results?.entities ?? []) as any[];
      console.log("  localities:", ents.slice(0, 50).map((e) => `${e.name}/${e.properties?.geocode?.country_code ?? e.properties?.country ?? "?"}:${(e.query?.affinity ?? e.affinity)?.toFixed?.(3)}`).join(", "));
    } catch (e) { console.log("  ERR", String(e).slice(0, 400)); }
  }
  console.log("\nstats:", q.stats);
}
it("qloo live probe", async () => { await main(); });
