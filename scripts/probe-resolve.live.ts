import { it } from "vitest";
import { getQloo } from "@/lib/qloo";
import { resolveArtist } from "@/lib/tour/actions";
it("resolve", async () => {
  const q = getQloo();
  const raw = await q.search("John Mulaney", ["urn:entity:artist", "urn:entity:person"], 3);
  console.log("tag keys:", Object.keys(((raw[0].raw as { tags?: unknown[] })?.tags?.[0] as object) ?? {}).join(","));
  console.log(raw.map((h) => `${h.name} ${h.types.join("/")} tagIds=${(h.tagIds ?? []).length}:${(h.tagIds ?? []).filter((t) => /comed|stand/i.test(t)).slice(0, 2).join("|")}`).join("\n"));
  for (const name of ["John Mulaney", "Taylor Swift", "Nate Bargatze", "Khruangbin"]) {
    const r = await resolveArtist(name, q);
    console.log(name, "->", r.hits.slice(0, 2).map((h) => `${h.name} <${h.kind}> ${h.hint?.slice(0, 40)}`).join(" | "));
  }
});
