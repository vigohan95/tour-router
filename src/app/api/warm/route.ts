import { warmCache } from "@/lib/warm";

export const maxDuration = 120;

/** POST -> runs the three suggestion briefs through the live Qloo client once, so the cache is hot for visitors. */
export async function POST() {
  const r = await warmCache();
  return Response.json(r);
}
