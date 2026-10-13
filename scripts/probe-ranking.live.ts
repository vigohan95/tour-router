/**
 * City-ranking probe (live). Compares three ways to score "how much does <city> care about <act>":
 *   A. filter.type=urn:entity:artist + signal.location.query=<city> + filter.results.entities=<act>  (one call per city)
 *   B. one country-level heatmap (geohash cells, normalised across the whole country) aggregated near each city
 *   C. per-city heatmap top-10 mean (the Day-0 design; expected to be ~1.0 everywhere because of per-area normalisation)
 * Plus: venue tag union / radius, openers with and without a location, person-entity signals for comedians.
 * Prints shapes and redacted summaries only. PROBE_STEP=a|b|c|venues|openers|person|all
 */
import { it } from "vitest";
import { LiveQloo } from "@/lib/qloo/live";
import { CITIES } from "@/lib/tour/cities";
import { haversineKm } from "@/lib/tour/route";

const q = new LiveQloo({ apiKey: process.env.QLOO_API_KEY!, baseUrl: process.env.QLOO_BASE_URL, concurrency: 2 });
type J = Record<string, any>;
const ACTS: Array<[string, string]> = [
  ["Khruangbin", "BAF6317A-DF94-4C90-92AE-63F86560C21B"],
  ["Taylor Swift", "4BBEF799-A0C4-4110-AB01-39216993C312"],
  ["Bad Bunny", "BDA1B73F-10E7-4D09-AC51-B796CCEC5FF3"],
  ["John Mulaney (person)", "BDA4DDC1-E7C1-410E-8001-C1E17E29465C"],
];
const CITY_SAMPLE = ["Austin", "Los Angeles", "Chicago", "Omaha", "Nashville", "Miami", "Portland", "Mexico City", "Toronto"];
const step = process.env.PROBE_STEP ?? "all";
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f3 = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? "-" : n.toFixed(3));
async function get(path: string, params: Record<string, string>): Promise<J | undefined> {
  try {
    return (await q.get(path, params)) as J;
  } catch (e) {
    console.log("   ERR", String(e).slice(0, 220));
    return undefined;
  }
}

it("ranking probe", async () => {
  if (step === "all" || step === "a") {
    console.log("\n### A. signal.location.query + filter.results.entities");
    for (const [name, id] of ACTS) {
      const row: string[] = [];
      for (const city of CITY_SAMPLE) {
        const r = await get("/v2/insights", { "filter.type": id.startsWith("BDA4") ? "urn:entity:person" : "urn:entity:artist", "signal.location.query": city, "filter.results.entities": id, take: "3" });
        const ents = (r?.results?.entities ?? []) as J[];
        const e = ents.find((x) => x.entity_id === id) ?? ents[0];
        row.push(`${city}=${f3(e?.query?.affinity)}${ents.length !== 1 ? `(n=${ents.length})` : ""}`);
        if (name === "Khruangbin" && city === "Austin") console.log("   shape keys:", Object.keys(r ?? {}), "entity.query:", JSON.stringify(e?.query).slice(0, 300), "warnings:", JSON.stringify(r?.warnings ?? null));
      }
      console.log(`   ${name}: ${row.join(" | ")}`);
    }
  }
  if (step === "all" || step === "b") {
    console.log("\n### B. country heatmap aggregated near each city (US; cells within 60 km; mean of top 5)");
    for (const [name, id] of ACTS) {
      const r = await get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location.query": "United States" });
      const cells = (r?.results?.heatmap ?? []) as J[];
      const scored = CITIES.filter((c) => c.country === "US").map((c) => {
        const near = cells.filter((h) => haversineKm({ lat: c.lat, lon: c.lon }, { lat: h.location.latitude, lon: h.location.longitude }) <= 60).map((h) => h.query.affinity as number).sort((a, b) => b - a);
        return { city: c.name, n: near.length, top5: mean(near.slice(0, 5)), max: near[0] };
      });
      scored.sort((a, b) => (b.top5 || 0) - (a.top5 || 0));
      console.log(`   ${name}: cells=${cells.length} geohashLen=${cells[0]?.location?.geohash?.length} cities with >=1 cell: ${scored.filter((s) => s.n > 0).length}/${scored.length}`);
      console.log(`     top: ${scored.slice(0, 10).map((s) => `${s.city} ${f3(s.top5)} (n=${s.n})`).join(" | ")}`);
      console.log(`     bottom: ${scored.slice(-6).map((s) => `${s.city} ${f3(s.top5)} (n=${s.n})`).join(" | ")}`);
    }
    for (const area of ["Canada", "Mexico", "United Kingdom", "Germany", "Australia"]) {
      const r = await get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ACTS[0][1], "filter.location.query": area });
      const cells = (r?.results?.heatmap ?? []) as J[];
      console.log(`   ${area}: resolved=${JSON.stringify(r?.query?.localities?.filter?.[0]?.name)} cells=${cells.length} geohashLen=${cells[0]?.location?.geohash?.length}`);
    }
  }
  if (step === "all" || step === "c") {
    console.log("\n### C. per-city heatmap (top-10 mean / cell count)");
    for (const [name, id] of ACTS.slice(0, 2)) {
      const row: string[] = [];
      for (const city of CITY_SAMPLE.slice(0, 5)) {
        const r = await get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location.query": city });
        const cells = (r?.results?.heatmap ?? []) as J[];
        const aff = cells.map((c) => c.query.affinity as number).sort((a, b) => b - a);
        row.push(`${city}=${f3(mean(aff.slice(0, 10)))}/${cells.length}`);
      }
      console.log(`   ${name}: ${row.join(" | ")}`);
    }
  }
  if (step === "all" || step === "venues") {
    console.log("\n### venues: tag union / operator / radius");
    const tags = "urn:tag:genre:place:live_music_venue,urn:tag:genre:place:concert_hall,urn:tag:genre:place:amphitheater,urn:tag:genre:place:arena,urn:tag:genre:place:performing_arts_theater";
    for (const [label, extra] of [["default", {}], ["operator union", { "operator.filter.tags": "union" }], ["union radius 0", { "operator.filter.tags": "union", "filter.location.radius": "0" }]] as const) {
      const r = await get("/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": ACTS[0][1], "filter.location.query": "Austin", "filter.tags": tags, take: "8", "feature.explainability": "true", ...extra });
      const ents = (r?.results?.entities ?? []) as J[];
      console.log(`   Austin ${label}: n=${ents.length} ${ents.map((e) => `${e.name} [${e.properties?.primary_genre?.name}] aff=${f3(e.query?.affinity)} city=${e.properties?.geocode?.city} rating=${e.properties?.business_rating} ex=${e.query?.explainability?.["signal.interests.entities"]?.[0]?.score}`).join(" | ")}`);
    }
    for (const city of ["Omaha", "Berlin", "Mexico City", "Toronto"]) {
      const r = await get("/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": ACTS[0][1], "filter.location.query": city, "filter.tags": tags, "operator.filter.tags": "union", take: "8" });
      const ents = (r?.results?.entities ?? []) as J[];
      console.log(`   ${city}: n=${ents.length} ${ents.map((e) => `${e.name} [${e.properties?.primary_genre?.name}] ${f3(e.query?.affinity)}`).join(" | ")}`);
    }
    const r = await get("/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": ACTS[0][1], "filter.location.query": "Austin", "filter.tags": "urn:tag:genre:place:live_music_venue", take: "50" });
    const ents = (r?.results?.entities ?? []) as J[];
    const propKeys = new Set<string>();
    for (const e of ents) for (const [k, v] of Object.entries(e.properties ?? {})) if (v !== null && v !== undefined) propKeys.add(k);
    console.log(`   Austin live_music_venue take=50: n=${ents.length}; non-null property keys across results: ${[...propKeys].sort().join(",")}`);
    console.log(`   any capacity/seating/cost keys: ${[...propKeys].filter((k) => /cap|seat|cost|price|rent|fee/i.test(k)).join(",") || "none"}; price_level values: ${JSON.stringify([...new Set(ents.map((e) => e.properties?.price_level))])}`);
  }
  if (step === "all" || step === "openers") {
    console.log("\n### openers: location effect and bias.trends");
    const base = { "filter.type": "urn:entity:artist", "signal.interests.entities": ACTS[0][1], take: "6", "filter.exclude.entities": ACTS[0][1] };
    for (const [label, extra] of [["no location, trends high", { "bias.trends": "high" }], ["Austin filter.location, trends high", { "filter.location.query": "Austin", "bias.trends": "high" }], ["Berlin filter.location, trends high", { "filter.location.query": "Berlin", "bias.trends": "high" }], ["Austin signal.location, trends high", { "signal.location.query": "Austin", "bias.trends": "high" }], ["Austin signal.location, trends off", { "signal.location.query": "Austin", "bias.trends": "off" }], ["Omaha signal.location, trends high", { "signal.location.query": "Omaha", "bias.trends": "high" }]] as const) {
      const r = await get("/v2/insights", { ...base, ...extra });
      const ents = (r?.results?.entities ?? []) as J[];
      console.log(`   ${label}: ${ents.map((e) => `${e.name} ${f3(e.query?.affinity)} g=${e.query?.measurements?.audience_growth}`).join(" | ")}`);
    }
  }
  if (step === "all" || step === "person") {
    console.log("\n### person entity (comedian) as signal");
    const pid = ACTS[3][1];
    for (const [label, params] of [["brand Austin", { "filter.type": "urn:entity:brand", "signal.interests.entities": pid, "filter.location.query": "Austin", take: "4", "feature.explainability": "true" }], ["venues Austin", { "filter.type": "urn:entity:place", "signal.interests.entities": pid, "filter.location.query": "Austin", "filter.tags": "urn:tag:genre:place:live_music_venue,urn:tag:genre:place:performing_arts_theater,urn:tag:genre:place:comedy_club", "operator.filter.tags": "union", take: "4" }], ["openers (person type)", { "filter.type": "urn:entity:person", "signal.interests.entities": pid, "signal.location.query": "Austin", "bias.trends": "high", "filter.exclude.entities": pid, take: "4" }], ["openers (artist type)", { "filter.type": "urn:entity:artist", "signal.interests.entities": pid, "signal.location.query": "Austin", "bias.trends": "high", take: "4" }]] as const) {
      const r = await get("/v2/insights", params as Record<string, string>);
      const ents = (r?.results?.entities ?? []) as J[];
      console.log(`   ${label}: n=${ents.length} ${ents.map((e) => `${e.name} [${e.subtype?.split(":").at(-1)}/${e.properties?.primary_genre?.name ?? ""}] ${f3(e.query?.affinity)} ex=${e.query?.explainability?.["signal.interests.entities"]?.[0]?.score}`).join(" | ")}`);
    }
    const t = await get("/v2/tags", { "filter.query": "comedy", "filter.parents.types": "urn:entity:place", take: "8" });
    console.log("   comedy place tags:", ((t?.results?.tags ?? t?.results ?? []) as J[]).map((x) => x.id).join(" | "));
    const s = await get("/search", { query: "Nate Bargatze", types: "urn:entity:artist,urn:entity:person", take: "4" });
    console.log("   search comedian both types:", ((s?.results ?? []) as J[]).map((x) => `${x.name} ${x.types?.join("/")} pop=${f3(x.popularity)} tags=${(x.tags ?? []).slice(0, 3).map((t: J) => t.name).join("/")}`).join(" | "));
  }
  console.log("\nstats:", q.stats);
});
