# Live API notes (hackathon.api.qloo.com, verified 2026-10-13)

What the live Qloo hackathon API actually returns for the calls Tour Router makes, what differed from the public docs, and the decisions taken. Every example below is **redacted**: entity ids are shortened to a prefix or replaced by `<id>`, and no response body is reproduced (the rules forbid committing Qloo response data). The probe scripts that produced these findings are in `scripts/*.live.ts` (they print shapes and counts, never bodies); run them with `npx vitest run --config scripts/vitest.live.config.mts <file>` and the key in `.env.local`.

## Endpoints and field names observed

| Call | Request (as sent) | Response fields read |
|---|---|---|
| Resolve act | `GET /search?query=<name>&types=urn:entity:artist,urn:entity:person&take=10` | `results[].entity_id`, `name`, `types[]`, `popularity`, `properties.short_description`, `tags[].{tag_id,name,type}` (`disambiguation` just repeats the name) |
| Heatmap | `GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=<id>&filter.location.query=<country>` | `results.heatmap[].location.{latitude,longitude,geohash}`, `query.{affinity,affinity_rank,popularity}`; `query.localities.filter[0].name` echoes the resolved locality |
| Venues | `GET /v2/insights?filter.type=urn:entity:place&signal.interests.entities=<id>&filter.location.query=<city>&filter.tags=<venue tags>&take=10&feature.explainability=true` | `results.entities[].{entity_id,name,type="urn:entity",subtype="urn:entity:place",popularity}`, `location.{lat,lon,geohash}`, `properties.{address,business_rating,price_level,primary_genre.{id,name},website,...}`, `tags[].{id,name,type}`, `query.affinity`, `query.explainability["signal.interests.entities"][].{entity_id,score}` |
| Brands | `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=<id>&signal.location.query=<city>&take=5&feature.explainability=true` | as above; detail from `properties.industries[0]` / `brand_type[0]` |
| Openers (music) | `GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<id>&signal.location.query=<city>&bias.trends=high&filter.exclude.entities=<id>&take=5&feature.explainability=true` | as above; detail from `properties.primary_genres[0]`; `query.measurements.audience_growth` was 0 everywhere |
| Openers (comedy) | same with `filter.type=urn:entity:person&take=30`, then filtered client-side to tags matching `/comed|stand[- ]?up/` | `tags[].name` (e.g. "American Stand-up Comedians") |

Other facts:
- Auth: `X-Api-Key` header only. ~140 requests over the day at concurrency 2 with 350 ms pacing: **no 429**. A parallel session hit 429 "Rate limit exceeded" at ~30 unpaced requests at concurrency 3, so the client paces starts (350 ms), caps in-flight at 2 and retries 429/5xx with backoff honouring `Retry-After`.
- `take` > 50 on entity insights -> HTTP 400. `take` is **ignored for heatmaps**: every cell comes back (Austin 732, Chicago 1,075, United States 4,950 at geohash-4, Taylor Swift US 11,808). A country heatmap is ~1.3 MB; it is cached privately in server memory.
- `output.heatmap.boundary=urn:entity:locality` returned HTTP 500 "System Error" for every country and for an 800 km point radius; `urn:geohash` is the only working boundary. `filter.type=urn:entity:locality` rejects artist signals ("All of the provided signal.interests.entities were invalid"). `urn:entity:destination` works but is tourism-shaped, not markets.
- `filter.location.query` resolves fuzzily: "North America" resolved to **North Carolina**. Countries resolve correctly ("Czech Republic" -> "Czechia"); every country code in `cities.ts` was checked (`COUNTRY_QUERY`). Ambiguous city names carry a `query` field ("Portland, Oregon", "Washington, D.C.").
- `filter.location.query` is honoured for places only; for artists, brands and persons it is **silently ignored** (identical results for Austin and Berlin). `signal.location.query` does change those results, so brands and openers use it: "what this city's population *and* the act's fans over-index on".
- `filter.tags` with several tags is a union; `operator.filter.tags=union` and `filter.location.radius=0` changed nothing. `urn:tag:genre:place:music_venue` does not exist (0 results); the real ones are `live_music_venue`, `concert_hall`, `amphitheater`, `arena`, `performing_arts_theater`, `comedy_club` (found via `GET /v2/tags?filter.query=...&filter.parents.types=urn:entity:place`). The union also matches places with a *secondary* venue tag (a gallery with "live music"), so places whose `primary_genre.id` is a venue genre are ordered first.
- Live places carry **no capacity and no cost**. `price_level` (1-3) exists on some. The policy's capacity window therefore only applies to venues that have a capacity (none live, all fixtures), and the card says what it knows (`primary_genre.name`, rating).
- Explainability per entity is a **flat key** `query.explainability["signal.interests.entities"] = [{ entity_id, score }]` (score 1.0 with one signal; with two signals the scores split, e.g. 0.52 / 0.48). The nested `query.explainability.signal.interests.entities.effect_on_top3_recs[].{entity_id, avg_score}` is a response-level aggregate. The docs' map shape was never seen; the parser accepts all three.
- Comedians: `/search` returns the same name as `urn:entity:person` (tags like "American Stand-up Comedians") and as `urn:entity:artist` (comedy albums). The **artist** entity's heatmap is empty everywhere (John Mulaney: 0 cells in Austin/Denver/Omaha); the **person** entity's heatmap is populated (1,695 cells in Austin; 9,452 at US level) and works as a signal for places and brands. So the resolver prefers a person hit with a comedy tag over the same-named artist, and the artist over a non-comedian person (Taylor Swift exists as both; the artist is kept).

## Ranking decision: one heatmap per country, binned to the cities

Three ways of scoring "how much does <city> care about <act>" were measured on the same acts (Khruangbin, Taylor Swift, Bad Bunny, John Mulaney) and nine cities:

| Method | Observation | Verdict |
|---|---|---|
| C. per-city heatmap, mean of the top-10 cells (the Day-0 design) | affinity is min-max normalised **inside the queried area**: every city has max 1.000 and mean 0.500 (Khruangbin Austin 0.994, Los Angeles 0.995, Chicago 0.996, Omaha 0.795 only because Omaha had 23 cells). Not comparable across cities. | rejected |
| A. `filter.type=urn:entity:artist&signal.location.query=<city>&filter.results.entities=<act>` (the act's affinity toward the city's taste) | crowds into 0.97-0.999 (Khruangbin: Austin 0.998, LA 0.998, Chicago 0.996, Omaha 0.968) and comes back **empty** when the act is not in the locality's result set: Bad Bunny empty in 8 of 9 cities (only Miami), Taylor Swift empty in LA, Miami, Mexico City, Toronto; John Mulaney 0.96-1.00 everywhere. Fine as a yes/no signal, too flat and too sparse for a ranking. | rejected for ranking |
| **B. one country-wide heatmap, cells within 60 km of each city, mean of the strongest 5** | one scale per country, discriminating and plausible: Khruangbin -> San Francisco 0.997, Denver 0.990, Los Angeles 0.988, Portland 0.987, Austin 0.983 ... St. Louis 0.668; Bad Bunny -> Miami 0.997, Orlando 0.994, New York 0.991, Los Angeles 0.991 ... Nashville 0.757; John Mulaney (person) -> Boston 0.989, Portland 0.985, Chicago 0.981 ... Miami 0.404; Taylor Swift flat (0.95 +- 0.03) as expected. 34/34 US cities had cells (8-21 each). 3 requests for North America instead of 41. | **chosen** |

Limits of B, stated in the UI and the share page: affinity is normalised within each country (the grid says "normalised within Canada"); cross-country order is indicative only. `popularity` of the same cells is reported separately as "Listeners" (volume, not over-index); the **taste lift** column is the metro-size rank minus the taste rank.

### Taste lift, Khruangbin, North America (live, 2026-10-13)

| # | City | Affinity | Listeners | Size rank | Lift |
|---|---|---|---|---|---|
| 1 | San Francisco | 99.7% | 99% | 16 | +15 |
| 2 | Denver | 99.0% | 99% | 23 | +21 |
| 3 | Los Angeles | 98.8% | 100% | 3 | 0 |
| 4 | Portland | 98.7% | 98% | 28 | +24 |
| 5 | Vancouver | 98.6% | 98% | 27 | +22 |
| 6 | Austin | 98.3% | 98% | 29 | +23 |
| 7 | Seattle | 97.6% | 98% | 19 | +12 |
| 8 | New York | 96.2% | 99% | 2 | -6 |
| 10 | Mexico City | 95.9% | 98% | 1 | -9 |
| 13 | Chicago | 93.1% | 97% | 4 | -9 |
| 15 | Houston | 90.6% | 96% | 6 | -9 |

Counterfactual (same 6 stops, same dates): population-only routing picks New York, Chicago, Dallas, Houston, Mexico City (+ Austin as the named start); taste swaps in Denver, San Francisco, Portland, Vancouver: average affinity 98.8% vs 93.9% (+5 pts), 4,417 km vs 6,502 km (-2,085 km). Bad Bunny: taste swaps in Montreal, Orlando, Monterrey for Los Angeles, Mexico City, Houston (+0.4 pts, -2,671 km).

## Co-bill markets: one heatmap signalled by headliner + tour opener (live, 2026-10-13)

Question: can a heatmap be signalled by two acts at once, so that cities are ranked on a *pairing* (headliner + support act) rather than on the headliner alone? Measured with the product's own pipeline (`scripts/probe-cobill.live.ts`): rank -> partners for the 6 routed stops -> tour opener = the act that recurs across the six per-city opener lists (ranked by stops appeared in, then mean affinity) -> `filter.type=urn:heatmap&signal.interests.entities=<headliner>,<opener>&filter.location.query=<country>` for United States, Canada, Mexico -> the same 60 km / top-5-cell binning as the headliner map.

Findings:
- The API **accepts two signal entities on a heatmap**: HTTP 200, 4,979 US cells for Khruangbin + SAULT (4,950 for Khruangbin alone, 3,529 for the opener alone). The joint map is not the headliner map and not the mean of the two single maps (e.g. US: Portland #4 headliner-only, #1 opener-only, #2 on the joint map; Houston #12 / #23 / #21). So the product uses the joint map directly; the cell-by-cell average of two single-signal maps exists only as a labelled fallback for a country whose two-signal request fails (`method: "averaged"`, shown in the UI), and was not needed live.
- Opener affinities with `signal.location.query=<city>` + `bias.trends=high` are **flat** (82-83% for every candidate in every city), so the tour-opener choice is carried by *how many stops* an act recurs in, and ties are broken by mean affinity at the second decimal (Khruangbin: SAULT 82.6% vs Kikagaku Moyo 82.5%, both 6/6). The UI shows the runners-up and lets the promoter pick one with one click; the per-city #1 stays listed as the local alternate.
- For the comedian, Qloo's `urn:entity:person` openers are well-known comics / comic actors (Colin Jost, Nick Kroll, Adam Scott, Aubrey Plaza), i.e. acts with the strongest *audience overlap*, not acts a promoter could book as support. The card says "opener" for the music path and "comic with the highest cross-affinity" for the comedy path; it is a pairing signal, not an availability claim.
- Cost: 3 extra Qloo requests per tour opener (one joint heatmap per country), on top of the 22 of a 6-city plan.

### Khruangbin + SAULT (tour opener, in the top openers of 6/6 routed stops; locals: Kikagaku Moyo in Portland, Denver, Austin)

| # | City | Headliner-only | Co-bill (joint) | Delta | Rank change |
|---|---|---|---|---|---|
| 1 | San Francisco * | 99.7% | 99.8% | +0.0 pts | #1 -> #1 |
| 2 | Denver * | 99.0% | 97.3% | -1.6 pts | #2 -> #8 |
| 3 | Los Angeles * | 98.8% | 99.7% | +0.9 pts | #3 -> #2 |
| 4 | Portland * | 98.7% | 98.7% | +0.0 pts | #4 -> #5 |
| 5 | Vancouver * | 98.6% | 98.6% | -0.0 pts | #5 -> #6 |
| 6 | Austin * | 98.3% | 96.5% | -1.8 pts | #6 -> #9 |
| 7 | Seattle | 97.6% | 99.4% | +1.8 pts | #7 -> #3 |
| 8 | New York | 96.2% | 99.2% | +3.0 pts | #8 -> #4 |
| 9 | San Diego | 96.1% | 95.1% | -1.0 pts | #9 -> #13 |
| 10 | Mexico City | 95.9% | 95.4% | -0.5 pts | #10 -> #12 |
| 11 | Toronto | 95.7% | 97.4% | +1.7 pts | #11 -> #7 |
| 13 | Chicago | 93.1% | 96.2% | +3.0 pts | #13 -> #10 |
| 14 | Washington | 90.9% | 95.9% | +5.0 pts | #14 -> #11 |

`*` = routed on the headliner-only route (top 6 under the default 160 km radius clause, start San Francisco). **Co-bill route vs headliner-only route** (same 6 stops, same start, same dates): the co-bill route adds Seattle and New York and drops Denver and Austin; headliner affinity 98.8% vs 98.3%, joint affinity 98.4% vs 99.2% (+0.8 pts for the pairing), 5,329 km vs 6,222 km (New York is the price). Order: San Francisco -> Los Angeles -> Portland -> Seattle -> Vancouver -> New York.

### John Mulaney (person) + Colin Jost (6/6 stops; the same act is #1 in every routed city)

| # | City | Headliner-only | Co-bill (joint) | Delta | Rank change |
|---|---|---|---|---|---|
| 1 | Boston * | 98.9% | 99.6% | +0.7 pts | #1 -> #1 |
| 2 | Portland * | 98.5% | 98.4% | -0.2 pts | #2 -> #6 |
| 3 | Vancouver * | 98.2% | 98.6% | +0.4 pts | #3 -> #5 |
| 4 | Chicago * | 98.1% | 98.7% | +0.6 pts | #4 -> #3 |
| 5 | Denver * | 97.7% | 99.2% | +1.5 pts | #5 -> #2 |
| 6 | Toronto * | 97.4% | 97.9% | +0.6 pts | #6 -> #8 |
| 7 | Seattle | 97.0% | 98.6% | +1.6 pts | #7 -> #4 |
| 8 | New York | 96.4% | 98.0% | +1.7 pts | #8 -> #7 |
| 10 | Washington | 94.3% | 96.6% | +2.4 pts | #10 -> #9 |
| 11 | Minneapolis | 93.8% | 96.4% | +2.6 pts | #11 -> #10 |
| 13 | Austin | 91.8% | 96.2% | +4.3 pts | #13 -> #12 |

Co-bill route vs headliner-only route: adds Seattle, drops Toronto; headliner affinity 98.1% vs 98.1%, joint 98.7% vs 98.8%, 4,868 km vs 4,852 km. For a comedian whose "opener" is the same act everywhere, the pairing barely moves the cities; it is the music case, where the local openers differ by region, that changes the route.

Limits: the joint affinity is normalised within each country like the headliner map (cross-country order indicative only); a 1-3 pt move at the top of a 90-100% range is a rank change, not a crowd-size claim; nothing here says the opener is available or affordable.

## Request -> result (redacted example)

1. `GET /search?query=Khruangbin&types=urn:entity:artist,urn:entity:person&take=10` -> first artist hit `BAF6317A...` ("Khruangbin", popularity 0.99).
2. `GET /v2/insights?filter.type=urn:heatmap&signal.interests.entities=BAF6317A...&filter.location.query=United States` (and `Canada`, `Mexico`) -> 4,950 / 558 / 453 cells; cells within 60 km of Denver: 18, strongest five average 0.990 -> Denver #2.
3. `GET /v2/insights?filter.type=urn:entity:place&signal.interests.entities=BAF6317A...&filter.location.query=Austin&filter.tags=urn:tag:genre:place:live_music_venue,...&take=10&feature.explainability=true` -> "Austin City Limits Live" first, affinity 0.865, explainability `[{ entity_id: "BAF6317A...", score: 1 }]`.
4. `GET /v2/insights?filter.type=urn:entity:brand&signal.interests.entities=BAF6317A...&signal.location.query=Austin&take=5&feature.explainability=true` -> "Patagonia" 0.986.
5. `GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=BAF6317A...&signal.location.query=Austin&bias.trends=high&filter.exclude.entities=BAF6317A...&take=5` -> "Kikagaku Moyo" 0.83.
6. Routing, dates, policy, audit, counterfactual: local, no Qloo call.

A 6-city North American plan is 22 Qloo requests (3 heatmaps + 6 x 3 partner calls + 1 search), ~13 s uncached at the paced rate; the "Qloo calls behind this plan" panel in the UI lists them with ids redacted.

## Not verified today

- LLM mode (Gemini / Groq): no `GOOGLE_GENERATIVE_AI_API_KEY` / `GROQ_API_KEY` was present; every live run used the keyless rule planner through the same AI SDK loop. The LLM path is exercised only by the unit tests' model selection.
- `urn:entity:podcast` as a signal (not probed).
- The quota ceiling: the day's ~140 requests never hit it; the kit says limits are per event and raised on request in Discord.
