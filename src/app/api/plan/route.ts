import { errorResponse, readBody, stateResponse, withSnapshot } from "@/lib/api";
import { evaluateAction } from "@/lib/policy/engine";
import { audit } from "@/lib/store";
import { buildItinerary, excludeCity } from "@/lib/tour/actions";
import { compareWith } from "@/lib/tour/compare";

/**
 * Direct plan edits from the grid (the human's own decisions, so no approval card; the policy still refuses
 * excluded cities so the grid and the agent cannot disagree).
 *   { op: "exclude", city, excluded, reason? }
 *   { op: "rebuild", cities: string[], keepOrder?: boolean, startCity?, startDate?, gapDays? }
 *   { op: "compare", against?: "population" | "popularity" | "previous" }
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  return withSnapshot(body, (store) => {
    try {
      if (body.op === "exclude") {
        const city = String(body.city ?? "");
        const c = excludeCity(store.plan, city, body.excluded !== false, typeof body.reason === "string" ? body.reason : "excluded in the grid");
        if (!c) return errorResponse(new Error(`"${city}" is not a ranked city`));
        audit({ actor: "user", tool: "exclude_city", action: `${c.excluded ? "Excluded" : "Re-included"} ${c.city}`, decision: "info" });
        if (store.plan.itinerary && c.excluded) {
          const remaining = store.plan.itinerary.stops.filter((s) => s.city !== c.city).map((s) => s.city);
          if (remaining.length) buildItinerary(store.plan.act!, store.plan, store.policy, { cities: remaining, keepOrder: true, startDate: store.plan.itinerary.startDate });
          else store.plan.itinerary = undefined;
        }
        return stateResponse();
      }
      if (body.op === "rebuild") {
        if (!store.plan.act) return errorResponse(new Error("No act selected"));
        const cities = Array.isArray(body.cities) ? body.cities.map(String) : [];
        const ev = evaluateAction("build_itinerary", { cities, keepOrder: body.keepOrder === true, startCity: typeof body.startCity === "string" ? body.startCity : undefined }, { policy: store.policy, plan: store.plan });
        if (ev.decision === "deny") return errorResponse(new Error(ev.reason));
        const it = buildItinerary(store.plan.act, store.plan, store.policy, {
          cities,
          keepOrder: body.keepOrder === true,
          startCity: typeof body.startCity === "string" ? body.startCity : undefined,
          startDate: typeof body.startDate === "string" ? body.startDate : store.plan.itinerary?.startDate,
          gapDays: typeof body.gapDays === "number" ? body.gapDays : undefined,
        });
        audit({ actor: "user", tool: "build_itinerary", action: `${body.keepOrder ? "Re-ordered" : "Re-routed"} ${it.stops.length} stops`, decision: ev.decision === "approve" ? "approved" : "allowed", reason: ev.decision === "approve" ? `You did this yourself. ${ev.reason}` : ev.reason, rule: ev.rule });
        return stateResponse();
      }
      if (body.op === "compare") {
        if (!store.plan.act) return errorResponse(new Error("No act selected"));
        const against = body.against === "popularity" || body.against === "previous" ? body.against : "population";
        const r = compareWith(store.plan.act, store.plan, store.policy, against);
        audit({ actor: "user", tool: "compare_plans", action: `Compared with ${r.label}`, decision: "info", output: { swappedIn: r.swappedIn.map((s) => s.city), swappedOut: r.swappedOut.map((s) => s.city) } });
        return stateResponse();
      }
      return errorResponse(new Error("Unknown op"));
    } catch (e) {
      return errorResponse(e);
    }
  });
}
