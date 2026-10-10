import { errorResponse, readBody, stateResponse, withSnapshot } from "@/lib/api";
import { audit } from "@/lib/store";
import { setAct } from "@/lib/tour/actions";

/** POST { act: { entity_id, name, hint?, popularity? }, snapshot } -> selects the act (resets the plan if it changed). */
export async function POST(req: Request) {
  const body = await readBody(req);
  const act = body.act as { entity_id?: string; name?: string; hint?: string; popularity?: number } | undefined;
  if (!act?.entity_id || !act.name) return errorResponse(new Error("act.entity_id and act.name are required"));
  return withSnapshot(body, (store) => {
    setAct(store.plan, { entity_id: act.entity_id!, name: act.name!, hint: act.hint, popularity: act.popularity });
    audit({ actor: "user", tool: "resolve_artist", action: `Selected ${act.name}`, decision: "info", input: { entity_id: act.entity_id } });
    return stateResponse();
  });
}
