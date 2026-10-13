# Tour Router

**Where should this act play next, and who should open?** Tour Router answers that from taste, not from last tour's ticket counts. Qloo says which cities' populations over-index on the act, which venue's crowd overlaps its fans, which local brand both audiences share and which trending act should open; an agent chains those answers into a dated, mapped, exportable itinerary inside a routing policy the promoter writes down, and shows what the taste data changed against routing by city size.

| You give | Qloo answers (live, cached privately) | You get |
|---|---|---|
| an act and a brief ("8 cities, North America, start in Austin, March 2027") | `/search` -> entity; one `urn:heatmap` per country -> fan affinity + listener density per city; `urn:entity:place` / `brand` / `artist` (or `person` for comedians) with `feature.explainability` | a ranked market table with **taste lift**, a venue + opener + brand per stop with Qloo's explainability, a routed itinerary (map, CSV / JSON / Markdown), a **counterfactual** against population-only routing, an audit log citing the policy field behind every decision, and a **share link** that opens the finished plan with no agent run |

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com). Taste data by [Qloo](https://docs.qloo.com) (Insights API, hackathon endpoint). Map tiles by OpenStreetMap contributors. MIT.

## Who it is for, and what it is not

A promoter or artist manager deciding where a tour goes **before** avails and holds: new acts, secondary markets, comedians and hosts with no streaming chart to read. It is the market-discovery layer, not a booking system: it knows nothing about venue availability, holds, radius clauses or past grosses (see "What the result does not establish").

## Request to result (live, verified 2026-10-13)

1. **Resolve the act.** `GET /search?query=<name>&types=urn:entity:artist,urn:entity:person`. Musicians are kept as the artist entity; a person hit with a comedy tag (e.g. "American Stand-up Comedians") wins over the same-named artist, because the comedian's listening signal lives on the person entity (the artist entity's heatmap is empty).
2. **Rank markets from one heatmap per country.** `GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=<act>&filter.location.query=United States` (and Canada, Mexico, ...). Qloo min-max normalises heatmap affinity *inside the queried area*, so per-city heatmaps are not comparable (every city's best cell is 1.0); one country-wide map is. Each candidate city's score is the mean of the strongest 5 cells within 60 km; the same cells' `popularity` is reported as **listeners** (volume); **taste lift** = metro-size rank minus taste rank. Cities with no cell in range are shown as *unscored*, never as 0. Across countries the scales are each normalised to their own country, and the grid says so.
3. **Partners per city.** Venues: `filter.type=urn:entity:place` + `filter.location.query=<city>` + `filter.tags=live_music_venue,concert_hall,amphitheater,arena,performing_arts_theater` (+ `comedy_club` for comedians), `feature.explainability=true`; places whose primary genre is a venue genre are ordered first. Brands and openers: `signal.location.query=<city>` (for these types Qloo ignores `filter.location`), `bias.trends=high`, the act excluded from its own openers. Every card shows Qloo's per-signal explainability (`query.explainability["signal.interests.entities"]`).
4. **Route.** Nearest neighbour + 2-opt over the chosen cities, show dates spaced by policy, each stop carrying its venue / opener / brand. Over the city cap or the per-city budget the agent stops and asks; excluded cities are refused.
5. **Counterfactual.** `compare_plans`: the same number of stops chosen by metro population (no Qloo) or by listener density, routed the same way; the diff shows the cities swapped in and out, the change in average affinity and km, and the openers / brands only the taste route finds. After "Skip X" the agent compares the rebuilt route with the previous one.
6. **Explain and share.** "Why Denver?" answers from the heatmap rank, the lift, the explainability scores and the route position. The share link (`/t/<payload>`) carries the whole plan in the URL (names and scores, no entity ids, no raw responses) and prints as a one-page promoter brief.

A 6-city North American plan is 22 Qloo requests (3 heatmaps, 6 x 3 partner calls, 1 search), ~13 s uncached. The "Qloo calls behind this plan" panel lists every request with entity ids redacted. Field names, limits and the ranking measurements are in [docs/LIVE-NOTES.md](docs/LIVE-NOTES.md).

### Taste lift, Khruangbin, North America (live)

| # | City | Fan affinity | Listeners | Size rank | Lift |
|---|---|---|---|---|---|
| 1 | San Francisco | 99.7% | 99% | 16 | +15 |
| 2 | Denver | 99.0% | 99% | 23 | +21 |
| 4 | Portland | 98.7% | 98% | 28 | +24 |
| 6 | Austin | 98.3% | 98% | 29 | +23 |
| 8 | New York | 96.2% | 99% | 2 | -6 |
| 13 | Chicago | 93.1% | 97% | 4 | -9 |

Population-only routing would play New York, Chicago, Dallas, Houston and Mexico City; the taste route swaps in Denver, San Francisco, Portland and Vancouver: average fan affinity 98.8% vs 93.9%, 4,417 km vs 6,502 km.

## Fixture vs live - exactly what is what

| Layer | Without `QLOO_API_KEY` (default) | With `QLOO_API_KEY` |
|---|---|---|
| `/search`, `/v2/insights` (place, brand, artist, person), heatmaps | **Synthetic fixtures** (`src/lib/qloo/fixture.ts`): names, venues, brands and every score are generated from a hash of the request. Deterministic, plausible, **not Qloo data**. A banner says so, every synthetic name ends in "(synthetic)", exports and the share page say so too. | Live calls to `https://hackathon.api.qloo.com` (`src/lib/qloo/live.ts`), parsed by the same code path. Responses are cached privately in server memory (paced at 350 ms, 2 in flight, bounded retries on 429/5xx); nothing is written to disk or to this repository. A Qloo failure shows a banner and the step fails; fixtures are never substituted. |
| City coordinates and metro sizes (`src/lib/tour/cities.ts`) | Public figures, rounded. Only used to draw the map, route, and rank by size for the lift. | same |
| Routing, dates, policy, audit, counterfactual, share page | Pure functions, same in both modes. | same |
| LLM | No key: a deterministic **rule planner** (`src/lib/llm/mock-model.ts`) drives the same tools through the real AI SDK loop. | Gemini (Google AI Studio) or Groq free tier; daily caps fall back to the rule planner so a public demo never dies. |

Set `QLOO_FIXTURES=1` to force fixtures even with a key (used by the tests).

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add QLOO_API_KEY (hackathon key) / GOOGLE_GENERATIVE_AI_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # vitest: adapters, live client, ranking, routing, policy, tools, agent loop, counterfactual, share, provenance
```

With no keys at all the whole product runs on fixtures (banner on). With the Qloo key, try the suggestion chips: `Plan an 8-city North American tour for Khruangbin starting in Austin in March 2027` (8 > the default 6-city cap, so the approval card appears), then `Why Denver?`, `Skip Las Vegas`, `Compare with population-only routing`, or `Route "John Mulaney" through 5 cities` for the comedy path. `QLOO_WARM=1` pre-warms the cache for the suggestion acts at server start (or `POST /api/warm`).

Live probes against the real API (print shapes and counts, never bodies): `npx vitest run --config scripts/vitest.live.config.mts scripts/<name>.live.ts`.

## Architecture

```
src/lib/qloo       typed adapter interface, live client (query building, parsing, private cache, pacing, retries), synthetic fixture adapter, call provenance sink
src/lib/tour       city catalogue (+ country queries), routing (haversine, NN + 2-opt), ranking / partners / itinerary actions, counterfactuals, share payload, exports
src/lib/policy     zod policy schema + pure evaluateAction(tool, input) -> allow | approve | deny (+ rule cited)
src/lib/agent      AI SDK tools (policy re-check + audit on execute), toolApproval gate, system prompt, runOnce
src/lib/llm        model selection (Gemini / Groq / rule planner), rule planner (LanguageModelV3), daily caps
src/lib/store.ts   client-carried snapshot (policy, plan, audit, Qloo calls); serverless-safe, one isolated plan per visitor
src/app/api        agent (streaming chat), state, search, act, policy, plan (grid edits + compare), warm
src/app/t/[payload]  read-only shared tour page (lz-string in the URL), printable
src/components     TourStudio, ActSearch, CityGrid (AG Grid), PartnerCards, TourMap (Leaflet), ItineraryPanel, ComparePanel, QlooCallsPanel, PolicyPanel, AgentDrawer, SharedTour
```

All dependencies are free: Next.js, Vercel AI SDK, AG Grid Community, Leaflet + react-leaflet, OpenStreetMap tiles, lz-string, zod, Tailwind, vitest.

## What the result does not establish

- Fan affinity is a taste over-index inside one country's heatmap, not a ticket forecast; listener density is not attendance. Scores from different countries are each normalised to their own country.
- Live Qloo places carry no capacity or cost, so the policy's capacity window and cost gate only apply where a figure exists (fixtures have them; live venues show their primary genre and rating instead).
- `filter.tags` is a union over every tag on a place, so a gallery with a secondary "live music" tag can appear; places whose primary genre is a venue genre are listed first, but the promoter should still read the card.
- Routing is a heuristic over great-circle distance; it ignores venue availability, holds, travel modes and radius clauses.
- The hosted demo keeps state in the browser (sessionStorage); refreshing keeps your plan, another browser starts fresh. Share links are self-contained.
- LLM mode was not exercised against the live API during development (no model key); the rule planner drove every live run through the same tool loop.
