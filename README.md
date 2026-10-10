# Tour Router

An agent that routes an act's tour by **taste**: Qloo says which cities' fans care about the act, which venue's crowd overlaps them, which local brand their audience over-indexes on and which trending local act should open. The agent chains those answers into a dated, mapped, exportable itinerary, inside a routing policy the promoter sets (city cap, budget per city, capacity window, exclusions, regions), asking for approval at the edges and never beyond them.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com). Taste data by [Qloo](https://docs.qloo.com) (Insights API). Map tiles by OpenStreetMap contributors. MIT.

## What it does

1. **Resolve the act** - `GET /search?query=<name>&types=urn:entity:artist` -> Qloo entity id.
2. **Rank markets** - for each candidate city, `GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=<act>&filter.location.query=<city>`; the mean of the strongest cells is the city's fan-affinity score. The policy's regions bound the candidate list.
3. **Pick partners per city** - three `GET /v2/insights` calls with `feature.explainability=true` and `filter.location.query=<city>`: `filter.type=urn:entity:place` (+ `filter.tags=urn:tag:genre:place:music_venue`) for venues, `urn:entity:brand` for a co-promotion brand, `urn:entity:artist` (+ `bias.trends=high`, `filter.exclude.entities=<act>`) for openers. The venue inside the policy's capacity window with the highest affinity is recommended; every card shows the explainability contributions.
4. **Build the itinerary** - nearest-neighbour + 2-opt over the chosen cities, show dates spaced by policy, each stop carries its venue / opener / brand. Over the city cap or the per-city budget the agent stops and asks; excluded cities are refused.
5. **Explain** - "Why Denver?" answers from the heatmap rank, the explainability scores and the route position.

The UI is the same pipeline, clickable: act search -> AG Grid of ranked markets (tick to exclude, edit the stop number to re-order) -> partner cards -> Leaflet map -> itinerary with CSV / JSON / Markdown export -> audit log of every decision and the policy field it cites.

## Fixture vs live - exactly what is what

| Layer | Without `QLOO_API_KEY` (default) | With `QLOO_API_KEY` |
|---|---|---|
| `/search`, `/v2/insights` (artist, place, brand), heatmap | **Synthetic fixtures** (`src/lib/qloo/fixture.ts`): names, venues, brands, capacities, costs and every affinity score are generated from a hash of the request. Deterministic, plausible, **not Qloo data**. The header badge says `data: synthetic fixtures`, every card says `synthetic fixture`, exports say so too. | Live calls to `https://hackathon.api.qloo.com` (`src/lib/qloo/live.ts`), parsed by the same code path. Responses are cached privately in server memory; nothing is written to disk or to this repository (hackathon rule). |
| City coordinates and metro sizes (`src/lib/tour/cities.ts`) | Public figures, rounded. Only used to draw the map and route; Qloo supplies the affinities. | same |
| Routing, dates, policy, audit | Pure functions, same in both modes. | same |
| LLM | No key: a deterministic **rule planner** (`src/lib/llm/mock-model.ts`) drives the same tools through the real AI SDK loop. | Gemini (Google AI Studio) or Groq free tier; daily caps fall back to the rule planner so a public demo never dies. |

Set `QLOO_FIXTURES=1` to force fixtures even with a key (used by the tests).

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add QLOO_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # vitest: adapter, live client, routing, policy, tools, agent loop, exports
```

With no keys at all the whole product runs on fixtures. Try: search `Nova Reyes`, select it, click **Plan tour with the agent**, or type `Route Max Ortega through 6 cities starting in Chicago in March 2027`. Then `Why <city>?`, `Skip <city>`, tick a city's Exclude box, set **Policy -> Max cities** to 3 and ask for 5 to see the approval card.

## Architecture

```
src/lib/qloo       typed adapter interface, live client (query building, parsing, cache, limiter, errors), synthetic fixture adapter
src/lib/tour       city catalogue, routing (haversine, NN + 2-opt), plan types, the five actions, exports
src/lib/policy     zod policy schema + pure evaluateAction(tool, input) -> allow | approve | deny (+ rule cited)
src/lib/agent      AI SDK 7 tools (policy re-check + audit on execute), toolApproval gate, system prompt, runOnce
src/lib/llm        model selection (Gemini / Groq / rule planner), rule planner (LanguageModelV3), daily caps
src/lib/store.ts   client-carried snapshot (policy, plan, audit); serverless-safe, one isolated plan per visitor
src/app/api        agent (streaming chat), state, search, act, policy, plan (grid edits)
src/components     TourStudio, ActSearch, CityGrid (AG Grid), PartnerCards, TourMap (Leaflet), ItineraryPanel, PolicyPanel, AgentDrawer
```

All dependencies are free: Next.js, Vercel AI SDK, AG Grid Community, Leaflet + react-leaflet, OpenStreetMap tiles, zod, Tailwind, vitest.

## Known limitations

- The heatmap-to-city aggregation (mean of the top 10 cells) is a design choice, not a Qloo recommendation; it will be checked against live data before submission and may switch to `urn:entity:locality` insights.
- Venue capacity and cost are only known when Qloo returns them in `properties`; the policy's capacity window is skipped for venues without a capacity, and cost gating only applies when an estimate exists.
- Routing is a heuristic over great-circle distance; it ignores venue availability, holds and travel modes.
- The hosted demo keeps state in the browser (sessionStorage); refreshing keeps your plan, another browser starts fresh.
