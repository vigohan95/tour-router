import { errorResponse } from "@/lib/api";
import { getQloo } from "@/lib/qloo";
import { resolveArtist } from "@/lib/tour/actions";

/** GET ?q=<name> -> { query, hits, mode }. Stateless: picking a hit goes through /api/act. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ query: "", hits: [], mode: getQloo().mode });
  try {
    return Response.json(await resolveArtist(q));
  } catch (e) {
    return errorResponse(e, 502);
  }
}
