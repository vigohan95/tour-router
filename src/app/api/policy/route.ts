import { errorResponse, readBody, stateResponse, withSnapshot } from "@/lib/api";
import { parsePolicy } from "@/lib/policy/schema";
import { audit } from "@/lib/store";

/** POST { policy, snapshot } -> validated policy applied to the session. */
export async function POST(req: Request) {
  const body = await readBody(req);
  return withSnapshot(body, (store) => {
    try {
      const next = parsePolicy(body.policy);
      store.policy = next;
      for (const c of store.plan.candidates) {
        const ex = next.excludeCities.some((x) => x.toLowerCase() === c.city.toLowerCase());
        if (ex) {
          c.excluded = true;
          c.excludedReason = "policy.excludeCities";
        } else if (c.excludedReason === "policy.excludeCities") {
          c.excluded = undefined;
          c.excludedReason = undefined;
        }
      }
      audit({ actor: "user", tool: "policy", action: "Policy updated", decision: "info", input: next });
      return stateResponse();
    } catch (e) {
      return errorResponse(e);
    }
  });
}
