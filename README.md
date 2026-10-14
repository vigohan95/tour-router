# Tour Router

**Routes a tour inside the promoter's own rules, and shows what the taste data changed.**

- **The policy gate.** The promoter writes the routing policy as data: city cap, budget per city, excluded cities, regions, capacity window, days between shows, **blackout dates, held venues, a radius clause (min km between any two stops) and a per-leg cap**. The agent acts freely inside it, stops with an approval card at the edges ("8 stops is over your 6-city cap"), and is refused beyond them ("New York and Philadelphia are 130 km apart, inside your 160 km radius clause"). Every decision in the audit log cites the policy field it was made on; held stops are pinned to their date and marked HELD; blackout dates are never show dates.
- **A tour opener and the co-bill markets.** From the per-city opener lists Qloo returns (`signal.location.query` per city), the act that recurs across the routed stops becomes the **tour opener** (per-city locals stay as alternates). Then one Qloo heatmap per country is signalled by **headliner + opener together** (`signal.interests.entities` with two ids), and every city shows its co-bill affinity next to the headliner-only one. For Khruangbin + SAULT the pairing moves Seattle #7 -> #3 and New York #8 -> #4, and costs Denver #2 -> #8 (live, [docs/LIVE-NOTES.md](docs/LIVE-NOTES.md)).
- **Two counterfactuals on identical routing.** *The obvious route*: the same number of stops chosen by metro size (what a model with no taste data picks), routed the same way, diffed in cities, average affinity, km, openers and brands. *Policy B*: the same brief under the current policy with one field changed (cap 6 -> 8, a city excluded, a 300 km radius, a blackout date), rebuilt from the cached ranking, with the decisions that flip: "Build a 6-stop itinerary: allowed under A, denied under B [minKmBetweenStops]". "Why not Chicago?" answers from both plus the policy.

| You give | Qloo answers (live, cached privately) | You get |
|---|---|---|
| an act, a brief ("8 cities, North America, start in Austin, March 2027") and your policy (holds, blackout dates, radius clause, cap, exclusions) | `/search` -> entity; one `urn:heatmap` per country -> fan affinity + listener density per city; `urn:entity:place` / `brand` / `artist` (or `person` for comedians) with `feature.explainability`; a second heatmap per country signalled by headliner + tour opener; one `urn:demographics` per act | a ranked market table (fan affinity, taste lift, co-bill affinity), a venue + opener + brand per stop with Qloo's explainability, a tour opener with local alternates, a dated itinerary that obeys the policy (map, CSV / JSON / Markdown), the obvious-route and policy-B counterfactuals, "why" / "why not" answers, an audit log citing the policy field behind every decision, and a share link that opens the governed plan as a printable promoter brief |

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com). Taste data by [Qloo](https://docs.qloo.com) (Insights API, hackathon endpoint). Map tiles by OpenStreetMap contributors. MIT.

## Who it is for, and what it is not

A promoter or artist manager deciding where a tour goes **before** avails: new acts, secondary markets, comedians and hosts with no streaming chart to read. It is the market-discovery layer with the promoter's own constraints applied: holds, blackout dates and the radius clause are *their* inputs (their calendar, their contracts), not venue data from Qloo. It knows nothing about venue availability beyond what the promoter typed, and nothing about past grosses (see "What the result does not establish").

## Request to result (live, verified 2026-10-13)

1. **Resolve the act.** `GET /search?query=<name>&types=urn:entity:artist,urn:entity:person`. Musicians are kept as the artist entity; a person hit with a comedy tag wins over the same-named artist, because the comedian's listening signal lives on the person entity (the artist entity's heatmap is empty). One `filter.type=urn:demographics` call per act feeds a small audience card (over/under-index per age and gender bucket, nothing more).
2. **Rank markets from one heatmap per country.** `GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=<act>&filter.location.query=United States` (and Canada, Mexico, ...). Qloo min-max normalises heatmap affinity *inside the queried area*, so per-city heatmaps are not comparable; one country-wide map is. Each candidate city's score is the mean of the strongest 5 cells within 60 km; the same cells' `popularity` is reported as **listeners**; **taste lift** = metro-size rank minus taste rank. Cities with no cell in range are shown as *unscored*, never as 0.
3. **Partners per city.** Venues: `filter.type=urn:entity:place` + `filter.location.query=<city>` + the venue tags that exist (`live_music_venue`, `concert_hall`, `amphitheater`, `arena`, `performing_arts_theater`, + `comedy_club` for comedians), `feature.explainability=true`. Brands and openers: `signal.location.query=<city>` (for these types Qloo ignores `filter.location`), `bias.trends=high`, the act excluded from its own openers.
4. **Route inside the policy.** Nearest neighbour + 2-opt over the chosen cities; dates spaced by policy, skipping blackout dates; held venues pin their city to their date (HELD). Over the cap or the budget the agent asks; excluded cities, two stops inside the radius clause, or a leg over the cap are refused, with the field named.
5. **Tour opener and co-bill markets.** Intersect the routed cities' opener lists; one heatmap per country with two signals; the grid gains "Co-bill" and "Co-bill #" columns, and `compare_plans against=cobill` diffs the headliner-only route against the route the pairing would pick.
6. **Counterfactuals.** `compare_plans`: the obvious route (metro size, no Qloo) or listener density, same stop count, same start, same routing; `against=policy` with one changed field rebuilds the route under policy B and lists the decisions that flip; after "Skip X" the agent compares the rebuilt route with the previous one.
7. **Explain and share.** "Why Denver?" answers from the heatmap rank, the lift, the explainability scores and the route position; "Why not Chicago?" from the rank, whether the obvious route would have played it, and the policy (excluded / radius clause / cap). The share link (`/t/<payload>`) carries the plan, the full policy snapshot and the newest audit decisions in the URL (names and scores, no entity ids), and prints as a one-page brief with "Rules this route obeyed" and "Where the agent asked, and where it was refused".

A 6-city North American plan is 23 Qloo requests (3 heatmaps, 6 x 3 partner calls, 1 search, 1 demographics), ~13 s uncached; the tour opener adds 3 (one joint heatmap per country). The "Qloo calls behind this plan" panel lists every request with entity ids redacted. Field names, limits and the measurements are in [docs/LIVE-NOTES.md](docs/LIVE-NOTES.md).

### Taste lift, Khruangbin, North America (live)

| # | City | Fan affinity | Listeners | Size rank | Lift |
|---|---|---|---|---|---|
| 1 | San Francisco | 99.7% | 99% | 16 | +15 |
| 2 | Denver | 99.0% | 99% | 23 | +21 |
| 4 | Portland | 98.7% | 98% | 28 | +24 |
| 6 | Austin | 98.3% | 98% | 29 | +23 |
| 8 | New York | 96.2% | 99% | 2 | -6 |
| 13 | Chicago | 93.1% | 97% | 4 | -9 |

The obvious route (biggest metros, what a model with no taste data picks) would play New York, Chicago, Dallas, Houston and Mexico City; the taste route swaps in Denver, San Francisco, Portland and Vancouver: average fan affinity 98.8% vs 93.9%, 4,417 km vs 6,502 km.

### Co-bill, Khruangbin + SAULT (live)

| City | Headliner-only | Co-bill (joint heatmap) | Rank change |
|---|---|---|---|
| San Francisco | 99.7% | 99.8% | #1 -> #1 |
| Denver | 99.0% | 97.3% | #2 -> #8 |
| Seattle | 97.6% | 99.4% | #7 -> #3 |
| New York | 96.2% | 99.2% | #8 -> #4 |
| Austin | 98.3% | 96.5% | #6 -> #9 |

The co-bill route adds Seattle and New York and drops Denver and Austin: joint affinity 99.2% vs 98.4%, 6,222 km vs 5,329 km. Full tables (and John Mulaney + Colin Jost) in LIVE-NOTES.

## Fixture vs live - exactly what is what

| Layer | Without `QLOO_API_KEY` (default) | With `QLOO_API_KEY` |
|---|---|---|
| `/search`, `/v2/insights` (place, brand, artist, person, demographics), heatmaps | **Synthetic fixtures** (`src/lib/qloo/fixture.ts`): names, venues, brands and every score are generated from a hash of the request. Deterministic, plausible, **not Qloo data**. A banner says so, every synthetic name ends in "(synthetic)", exports and the share page say so too. | Live calls to `https://hackathon.api.qloo.com` (`src/lib/qloo/live.ts`), parsed by the same code path. Responses are cached privately in server memory (paced at 350 ms, 2 in flight, bounded retries on 429/5xx); nothing is written to disk or to this repository. A Qloo failure shows a banner and the step fails; fixtures are never substituted. |
| City coordinates and metro sizes (`src/lib/tour/cities.ts`) | Public figures, rounded. Only used to draw the map, route, and rank by size for the lift and the obvious route. | same |
| Policy, routing, dates, holds, radius clause, audit, counterfactuals, share page | Pure functions, same in both modes. | same |
| LLM | No key: a deterministic **rule planner** (`src/lib/llm/mock-model.ts`) drives the same tools through the real AI SDK loop. | Gemini (Google AI Studio) or Groq free tier; daily caps fall back to the rule planner so a public demo never dies. |

Set `QLOO_FIXTURES=1` to force fixtures even with a key (used by the tests).

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add QLOO_API_KEY (hackathon key) / GOOGLE_GENERATIVE_AI_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # vitest: adapters, live client, ranking, routing, policy (holds / blackouts / radius), tools, agent loop, counterfactuals, co-bill, policy B, why-not, share, audience, provenance
```

With no keys at all the whole product runs on fixtures (banner on). With the Qloo key, try the suggestion chips: `Plan an 8-city North American tour for Khruangbin starting in Austin in March 2027` (8 > the default 6-city cap, so the approval card appears), then `Why Denver?`, `Why not Chicago?`, `Who should open the whole tour?`, `Compare the co-bill route`, `What if the cap were 8?`, `Skip Las Vegas`, `Compare with population-only routing`, or `Route "John Mulaney" through 5 cities` for the comedy path. Open **Policy** to add a held venue (`Denver; Mission Ballroom; 2027-03-12`), blackout dates or a radius clause, and re-route. `QLOO_WARM=1` pre-warms the cache for the suggestion acts at server start (or `POST /api/warm`).

Live probes against the real API (print shapes and counts, never bodies): `npx vitest run --config scripts/vitest.live.config.mts scripts/<name>.live.ts`.

Record screenshots or the demo video (`scripts/screenshots.py`, `scripts/screenshots-v2.py`, `scripts/make_video.py`) against a production server (`npm run build && npm run start -- -p 3200`), not `next dev`: Turbopack's dev watcher covers the whole project directory, so the frames those scripts write trigger full page reloads mid-recording. `AGENTS.md` at the repo root is written by `next dev` itself and is git-ignored.

## Architecture

```
src/lib/qloo       typed adapter interface, live client (query building, parsing, private cache, pacing, retries), synthetic fixture adapter, call provenance sink
src/lib/tour       city catalogue (+ country queries), routing (haversine, NN + 2-opt, dates with blackouts / holds), legs (radius clause, per-leg cap),
                   ranking / partners / itinerary / tour-opener / audience actions, counterfactuals (obvious route, listeners, previous, co-bill), policy counterfactual, why-not, share payload, exports
src/lib/policy     zod policy schema (incl. blackoutDates, heldVenues, minKmBetweenStops, maxKmPerLeg) + pure evaluateAction(tool, input) -> allow | approve | deny (+ rule cited)
src/lib/agent      AI SDK tools (policy re-check + audit on execute), toolApproval gate, system prompt, runOnce
src/lib/llm        model selection (Gemini / Groq / rule planner), rule planner (LanguageModelV3), daily caps
src/lib/store.ts   client-carried snapshot (policy, plan, audit, Qloo calls); serverless-safe, one isolated plan per visitor
src/app/api        agent (streaming chat), state, search, act, policy, plan (grid edits, compare, co-bill), warm
src/app/t/[payload]  read-only shared tour page (lz-string in the URL; plan + policy snapshot + audit), printable
src/components     TourStudio, ActSearch, AudienceCard, CityGrid (AG Grid), PartnerCards, CoBillPanel, TourMap (Leaflet), ItineraryPanel, ComparePanel (+ policy B), QlooCallsPanel, PolicyPanel, AgentDrawer, SharedTour
```

All dependencies are free: Next.js, Vercel AI SDK, AG Grid Community, Leaflet + react-leaflet, OpenStreetMap tiles, lz-string, zod, Tailwind, vitest. 93 tests.

## What the result does not establish

- Fan affinity is a taste over-index inside one country's heatmap, not a ticket forecast; listener density is not attendance. Scores from different countries are each normalised to their own country; the co-bill affinity is normalised the same way.
- Live Qloo places carry no capacity or cost, so the policy's capacity window and cost gate only apply where a figure exists (fixtures have them; live venues show their primary genre and rating instead).
- `filter.tags` is a union over every tag on a place, so a gallery with a secondary "live music" tag can appear; places whose primary genre is a venue genre are listed first, but the promoter should still read the card.
- Holds, blackout dates and the radius clause are the promoter's inputs, not venue data: the router obeys them, it cannot discover them. A held venue matched to a Qloo card keeps that card's affinity; an unmatched one shows "promoter hold, not a Qloo result". Routing is a heuristic over great-circle distance and ignores travel modes.
- Opener affinities from `signal.location.query` + `bias.trends=high` are flat (82-83%), so the tour-opener pick is carried by how many stops an act recurs in; for comedians the "openers" Qloo returns are well-known comics with the strongest audience overlap, a pairing signal, not acts a promoter could book as support. The runners-up are one click away.
- The demographics card is Qloo's over/under-index per bucket (-1..1): not an audience share, not a count, and it does not feed the routing.
- The hosted demo keeps state in the browser (sessionStorage); refreshing keeps your plan, another browser starts fresh. Share links are self-contained.
- LLM mode was not exercised against the live API during development (no model key); the rule planner drove every live run through the same tool loop.
