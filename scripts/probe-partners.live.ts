/** Partner-query probe (live): brand locality effect, comedian person tags, country heatmap resolution for every CITIES country. Shapes/redacted only. */
import { it } from "vitest";
import { LiveQloo } from "@/lib/qloo/live";
import { CITIES } from "@/lib/tour/cities";

const q = new LiveQloo({ apiKey: process.env.QLOO_API_KEY!, baseUrl: process.env.QLOO_BASE_URL, concurrency: 2 });
type J = Record<string, any>;
const ACT = "BAF6317A-DF94-4C90-92AE-63F86560C21B"; // Khruangbin
const PERSON = "BDA4DDC1-E7C1-410E-8001-C1E17E29465C"; // John Mulaney (person)
const f3 = (n: number | undefined) => (n === undefined ? "-" : n.toFixed(3));
const COUNTRY: Record<string, string> = { US: "United States", CA: "Canada", MX: "Mexico", GB: "United Kingdom", UK: "United Kingdom", IE: "Ireland", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain", IT: "Italy", SE: "Sweden", BE: "Belgium", PT: "Portugal", PL: "Poland", AT: "Austria", CZ: "Czech Republic", DK: "Denmark", NO: "Norway", CH: "Switzerland", FI: "Finland", AU: "Australia", NZ: "New Zealand", BR: "Brazil", AR: "Argentina", CL: "Chile", CO: "Colombia", PE: "Peru", UY: "Uruguay", GR: "Greece", HU: "Hungary" };
async function get(path: string, params: Record<string, string>): Promise<J | undefined> {
  try {
    return (await q.get(path, params)) as J;
  } catch (e) {
    console.log("   ERR", String(e).slice(0, 200));
    return undefined;
  }
}
it("partners probe", async () => {
  console.log("\n### brands: location handling");
  for (const [label, extra] of [["no location", {}], ["filter.location Austin", { "filter.location.query": "Austin" }], ["signal.location Austin", { "signal.location.query": "Austin" }], ["signal.location Omaha", { "signal.location.query": "Omaha" }], ["signal.location Berlin", { "signal.location.query": "Berlin" }]] as const) {
    const r = await get("/v2/insights", { "filter.type": "urn:entity:brand", "signal.interests.entities": ACT, take: "5", "feature.explainability": "true", ...extra });
    const ents = (r?.results?.entities ?? []) as J[];
    console.log(`   ${label}: ${ents.map((e) => `${e.name} ${f3(e.query?.affinity)} [${e.properties?.industries?.[0] ?? e.properties?.brand_type?.[0] ?? ""}]`).join(" | ")}`);
  }
  console.log("\n### comedian openers: person tags");
  const t = await get("/v2/tags", { "filter.query": "stand-up", "filter.parents.types": "urn:entity:person", take: "10" });
  const tags = ((t?.results?.tags ?? t?.results ?? []) as J[]).map((x) => `${x.id} (${x.name})`);
  console.log("   person stand-up tags:", tags.join(" | "));
  for (const tag of ["urn:tag:wikipedia_category:qloo:american_stand_up_comedians", "urn:tag:occupation:qloo:comedian", "urn:tag:occupation:qloo:stand_up_comedian"]) {
    const r = await get("/v2/insights", { "filter.type": "urn:entity:person", "signal.interests.entities": PERSON, "signal.location.query": "Austin", "filter.tags": tag, "bias.trends": "high", "filter.exclude.entities": PERSON, take: "5", "feature.explainability": "true" });
    const ents = (r?.results?.entities ?? []) as J[];
    console.log(`   persons tag=${tag}: n=${ents.length} ${ents.map((e) => `${e.name} ${f3(e.query?.affinity)} ex=${e.query?.explainability?.["signal.interests.entities"]?.[0]?.score}`).join(" | ")}`);
  }
  const s = await get("/search", { query: "John Mulaney", types: "urn:entity:person", take: "1" });
  const ptags = ((s?.results?.[0]?.tags ?? []) as J[]).map((x) => `${x.id}`);
  console.log("   Mulaney person tags:", ptags.filter((x) => /comed|stand/i.test(x)).join(" | "), "| total", ptags.length);
  console.log("\n### country heatmap resolution for every CITIES country");
  const codes = [...new Set(CITIES.map((c) => c.country))];
  console.log("   codes:", codes.join(","), "| unmapped:", codes.filter((c) => !COUNTRY[c]).join(",") || "none");
  for (const code of codes) {
    const name = COUNTRY[code];
    if (!name) continue;
    const r = await get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ACT, "filter.location.query": name });
    const cells = (r?.results?.heatmap ?? []) as J[];
    const resolved = r?.query?.localities?.filter?.[0];
    console.log(`   ${code} "${name}" -> ${JSON.stringify(resolved?.name)} (${resolved?.subtype}) cells=${cells.length} geohashLen=${cells[0]?.location?.geohash?.length ?? "-"} bytes~${JSON.stringify(r ?? {}).length}`);
  }
  console.log("\nstats:", q.stats);
});
