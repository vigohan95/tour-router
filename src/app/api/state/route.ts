import { readBody, stateResponse, withSnapshot } from "@/lib/api";

/** POST { snapshot? } -> { view, snapshot }. A missing or malformed snapshot yields a fresh session. */
export async function POST(req: Request) {
  const body = await readBody(req);
  return withSnapshot(body, () => stateResponse());
}
