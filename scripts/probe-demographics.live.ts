/**
 * urn:demographics probe (live): the response shape for one act (keys, value ranges), never a body dump.
 *   npx vitest run --config scripts/vitest.live.config.mts --silent=false scripts/probe-demographics.live.ts
 */
import { it } from "vitest";
import { LiveQloo } from "@/lib/qloo/live";

const q = new LiveQloo({ apiKey: process.env.QLOO_API_KEY!, baseUrl: process.env.QLOO_BASE_URL, concurrency: 2 });
type J = Record<string, any>;

it("demographics shape", async () => {
  for (const [name, types] of [["Khruangbin", "urn:entity:artist"], ["John Mulaney", "urn:entity:person"]] as const) {
    const hits = await q.search(name, [types], 5);
    const hit = hits.find((h) => h.types.includes(types) && (types !== "urn:entity:person" || (h.tagIds ?? []).some((t) => /stand[- _]?up|comedian/i.test(t))))!;
    const body = (await q.get("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": hit.entity_id })) as J;
    const results = body.results ?? {};
    console.log(`\n## ${name}: top-level keys=${Object.keys(body)} results keys=${Object.keys(results)}`);
    const demos = (results.demographics ?? []) as J[];
    console.log(`demographics[] length=${demos.length}; item keys=${demos[0] ? Object.keys(demos[0]) : "-"}; query keys=${demos[0]?.query ? Object.keys(demos[0].query) : "-"}`);
    const qd = demos[0]?.query ?? {};
    for (const k of Object.keys(qd)) {
      const v = qd[k];
      console.log(`  ${k}: ${typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a}=${typeof b === "number" ? b.toFixed(3) : JSON.stringify(b)}`).join(", ") : v}`);
    }
    console.log(`  warnings=${JSON.stringify(body.warnings ?? null)}`);
  }
  console.log("stats:", q.stats);
});
