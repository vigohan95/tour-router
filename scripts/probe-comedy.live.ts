/** Comedian probe (live): combined artist+person search ordering, stand-up tag for person openers, comedy-club venues. Shapes/redacted only. */
import { it } from "vitest";
import { LiveQloo } from "@/lib/qloo/live";

const q = new LiveQloo({ apiKey: process.env.QLOO_API_KEY!, baseUrl: process.env.QLOO_BASE_URL, concurrency: 2 });
type J = Record<string, any>;
const PERSON = "BDA4DDC1-E7C1-410E-8001-C1E17E29465C"; // John Mulaney (person)
const f3 = (n: number | undefined) => (n === undefined ? "-" : n.toFixed(3));
async function get(path: string, params: Record<string, string>): Promise<J | undefined> {
  try {
    return (await q.get(path, params)) as J;
  } catch (e) {
    console.log("   ERR", String(e).slice(0, 200));
    return undefined;
  }
}
it("comedy probe", async () => {
  console.log("\n### combined search ordering");
  for (const name of ["Taylor Swift", "Khruangbin", "John Mulaney", "Nate Bargatze", "Ali Wong", "Bad Bunny", "Joe Rogan"]) {
    const r = await get("/search", { query: name, types: "urn:entity:artist,urn:entity:person", take: "6" });
    const hits = (r?.results ?? []) as J[];
    console.log(`   ${name}: ${hits.map((h) => `${h.name} <${h.types?.[0]?.split(":").at(-1)}> pop=${f3(h.popularity)} tags=${(h.tags ?? []).filter((t: J) => /comed|stand|actor|music|genre/i.test(`${t.id} ${t.name}`)).slice(0, 3).map((t: J) => t.name).join("/")}`).join(" | ")}`);
  }
  console.log("\n### person tags on Mulaney (all)");
  const s = await get("/search", { query: "John Mulaney", types: "urn:entity:person", take: "1" });
  console.log("   ", ((s?.results?.[0]?.tags ?? []) as J[]).map((t) => t.id).join(" | ").slice(0, 1500));
  console.log("\n### person openers with stand-up tag");
  for (const tag of ["urn:tag:occupation:wikidata:stand_up_comedian", "urn:tag:occupation:wikidata:comedian"]) {
    for (const loc of ["Austin", "Denver"]) {
      const r = await get("/v2/insights", { "filter.type": "urn:entity:person", "signal.interests.entities": PERSON, "signal.location.query": loc, "filter.tags": tag, "bias.trends": "high", "filter.exclude.entities": PERSON, take: "6", "feature.explainability": "true" });
      const ents = (r?.results?.entities ?? []) as J[];
      console.log(`   ${tag.split(":").at(-1)} @${loc}: n=${ents.length} ${ents.map((e) => `${e.name} ${f3(e.query?.affinity)} ex=${e.query?.explainability?.["signal.interests.entities"]?.[0]?.score}`).join(" | ")}`);
    }
  }
  console.log("\n### comedy venues for a person signal");
  const tags = "urn:tag:genre:place:comedy_club,urn:tag:genre:place:performing_arts_theater,urn:tag:genre:place:live_music_venue,urn:tag:genre:place:concert_hall";
  for (const city of ["Austin", "Chicago"]) {
    const r = await get("/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": PERSON, "filter.location.query": city, "filter.tags": tags, take: "8", "feature.explainability": "true" });
    const ents = (r?.results?.entities ?? []) as J[];
    console.log(`   ${city}: ${ents.map((e) => `${e.name} [${e.properties?.primary_genre?.name}] ${f3(e.query?.affinity)} ex=${e.query?.explainability?.["signal.interests.entities"]?.[0]?.score}`).join(" | ")}`);
  }
  console.log("\n### artist openers for a person signal, signal.location");
  const r = await get("/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": PERSON, "signal.location.query": "Austin", "bias.trends": "high", take: "5", "feature.explainability": "true" });
  console.log("   ", ((r?.results?.entities ?? []) as J[]).map((e) => `${e.name} ${f3(e.query?.affinity)} [${e.properties?.primary_genres?.[0]}] ex=${e.query?.explainability?.["signal.interests.entities"]?.[0]?.score}`).join(" | "));
  console.log("\nstats:", q.stats);
});
