import { it } from "vitest";
import { getQloo } from "@/lib/qloo";
const PERSON = "BDA4DDC1-E7C1-410E-8001-C1E17E29465C"; // John Mulaney (person)
it("comedy openers", async () => {
  const q = getQloo();
  for (const city of ["Austin", "Boston"]) {
    const a = await q.insights({ type: "urn:entity:artist", signalEntities: [PERSON], signalLocation: { query: city }, tags: ["urn:tag:genre:comedy"], trends: "high", take: 6, explainability: true });
    console.log(`artist+comedy tag @${city}:`, a.entities.map((e) => `${e.name} ${e.affinity.toFixed(3)} [${(e.properties.primary_genres as string[] | undefined)?.[0]}] tags=${e.tags.slice(0, 2).join("/")}`).join(" | "));
    const p = await q.insights({ type: "urn:entity:person", signalEntities: [PERSON], signalLocation: { query: city }, trends: "high", excludeEntities: [PERSON], take: 30 });
    const strict = p.entities.filter((e) => e.tags.some((t) => /stand[- _]?up|comedian/i.test(t)));
    console.log(`person strict @${city}: ${strict.length}/${p.entities.length}:`, strict.slice(0, 6).map((e) => `${e.name} ${e.affinity.toFixed(3)} [${e.tags.find((t) => /stand[- _]?up|comedian/i.test(t))}]`).join(" | "));
    console.log(`  first person tags: ${p.entities[0]?.name}: ${p.entities[0]?.tags.slice(0, 6).join("/")}`);
  }
});
