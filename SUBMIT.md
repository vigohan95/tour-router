# Submission kit - Qloo Agentic Hackathon (Devpost)

Deadline: **2026-10-30 23:45 ET** (= 2026-10-31 03:45 UTC). Judging Nov 2-16, winners ~Nov 23. Prize pool $25,000 (3 cash prizes; exact split is on the Devpost prize tab, which sits behind a Cloudflare check and could not be read on 2026-10-10).
Repo: https://github.com/vigohan95/tour-router (**private today; must be public with the MIT file visible in About before submitting**).
State (2026-10-13): live-verified against hackathon.api.qloo.com (docs/LIVE-NOTES.md), 58 tests green, gallery stills in docs/screenshots/, three share links in docs/share-links.local.md (git-ignored). Not deployed yet.

Rules that bind us (from the Official Rules text stored in the ledger, opp 526):
- Working software that integrates the Qloo API and is agentic (ours: AI SDK 7 agent loop with five Qloo tools behind a policy gate).
- Must provide a **functional demo link** + **public repo** with an OSS license detectable at the top of the repo page + text description.
- Hackathon key only works on `https://hackathon.api.qloo.com`; private server-side caching allowed; **never commit Qloo response data to the repo** (our cache is in-memory only; fixtures are synthetic by hash, not Qloo data).
- Judges may judge from text/images/video alone, so the video and gallery carry the argument.
- Judging criteria (from the theme page, 2026-10-13; four equal criteria after a pass/fail on "reasonable use of the required API"): **Technological Implementation** ("How thoroughly and skillfully does the project use Qloo?" / "a working, non-trivial implementation"), **Design** ("a complete, coherent product experience, not just a technical proof of concept"), **Potential Impact** ("a credible, specific case for solving a real problem for a real audience"), **Quality of the Idea** ("a creative, non-obvious use of Qloo"). Prizes $15k / $6k / $4k. The kit's SUBMISSION.md adds: problem statement, which Qloo workflows and why, a redacted request-to-result, screenshots without credentials, clean-environment setup, known limitations ("what the result does not establish") - the README now has all six.

## A. Devpost fields (paste as-is, edit links)

**Project name**
`Tour Router`

**Tagline** (max 60 chars)
`Routes an act's tour by taste: Qloo picks cities, venues, openers`
(59 chars. Alternative: `An agent that books a tour where the fans actually are`)

**About the project**

*Inspiration*
A promoter routing a 12-city tour works from last tour's ticket counts and whoever a booking agent knows in each market. Qloo already knows which cities' audiences over-index on an act, which venue's crowd overlaps them, which local brand their fans care about and which local artist is trending with the same audience. Nobody chains those answers into a routed, dated itinerary. We wanted an agent that does the chaining, and does it inside a routing policy the promoter writes down, so it asks at the edges and never past them.

*What it does*
Tour Router plans a tour from taste. Type an act and a brief ("Plan an 8-city North American tour for Khruangbin starting in Austin in March 2027"); the agent resolves the act with Qloo `/search` (musicians as artist entities, comedians as person entities), reads ONE Qloo heatmap per country for the act and scores every candidate city from the cells around it (fan affinity, plus listener density and a **taste lift** = size rank minus taste rank: Denver +21, Portland +24, New York -6 for Khruangbin), then for each chosen city asks Qloo Insights, with `feature.explainability=true`, for the venue whose crowd most overlaps the act's fans, a brand the city's audience and the fans both over-index on, and a trending opener for that market (`signal.location.query`, `bias.trends=high`, the act excluded). It routes the cities (nearest neighbour + 2-opt), spaces show dates by policy, exports CSV / JSON / Markdown and a share link that opens the finished plan as a printable promoter brief. Then it answers the hackathon's own question: `compare_plans` builds the same tour by metro population (no Qloo) and shows what taste changed - for Khruangbin, Denver / San Francisco / Portland / Vancouver in, New York / Chicago / Dallas / Houston out, +5 pts average affinity, -2,085 km. The policy (max cities, budget per city, capacity window, excluded cities, regions) is data: over the cap the agent stops and shows an approval card (the first suggested brief asks for 8 cities against a 6-city cap); excluded cities are refused; "Skip Denver" rebuilds and reports the diff against the previous route; every decision lands in an audit log naming the policy field it was made on, and a "Qloo calls behind this plan" panel lists every request with ids redacted. The UI is the same pipeline, clickable: act search, AG Grid of ranked markets with taste lift (tick to exclude, edit the stop number to re-order), partner cards, Leaflet map, itinerary, counterfactual panel, audit log.

*How we built it*
- Qloo: a typed adapter over `/search` (artist + person), `/v2/insights` (`urn:entity:place` + the venue tags that actually exist - `live_music_venue`, `concert_hall`, `amphitheater`, `arena`, `performing_arts_theater`, `comedy_club` - plus `urn:entity:brand`, `urn:entity:artist`, `urn:entity:person` with `signal.location.query`), and `filter.type=urn:heatmap` per country, all against `https://hackathon.api.qloo.com` with the key in `X-Api-Key`; query building, parsing of the live field names (flat `query.explainability["signal.interests.entities"]`, `properties.primary_genre`), a private in-memory cache (nothing on disk, nothing in the repo), request pacing with bounded retries on 429/5xx, typed errors that surface as a banner (fixtures are never substituted). A synthetic fixture adapter implements the same interface (deterministic from a hash, every name suffixed "(synthetic)") so the product and the tests run with no key.
- Agent: Vercel AI SDK 7 agent loop (`streamText`, multi-step tools, `toolApproval`) with five Qloo tools plus `exclude_city`; a pure policy engine evaluates each call (allow / approve / deny) and cites the rule; the system prompt carries the policy and the current plan. Gemini (AI Studio) or Groq free tiers, behind per-visitor and global daily caps; past the cap, a keyless rule planner that implements `LanguageModelV3` drives the same tools, so the hosted demo never dies and the test suite exercises the real loop.
- UI: Next.js 16 App Router, React 19, AG Grid Community (ranked markets with inline exclude / re-order, cell flash on re-rank), Leaflet + OpenStreetMap, Tailwind. Client-carried state snapshot, so the hosted demo is serverless-safe and each visitor plans in isolation.
- 58 vitest tests: adapters and live-client parsing / pacing / retries, the one-heatmap ranking with taste lift, counterfactuals, share payload round-trip, provenance, routing, policy, tools, agent loop, exports, quota.

*Challenges we ran into*
Turning a heatmap into a city score. Qloo normalises heatmap affinity inside the queried area, so one heatmap per city gives every city a top cell of 1.0 and nothing to rank; asking Qloo for the act's affinity toward each city's taste (`filter.results.entities`) comes back flat (0.97-0.999) and empty for many city/act pairs. One heatmap per country, binned to the cities within 60 km, ranks on a single scale and gave rankings a promoter recognises (Bad Bunny: Miami, Orlando, New York, Los Angeles; Khruangbin: San Francisco, Denver, Los Angeles, Portland, Austin) - docs/LIVE-NOTES.md has the measurements. Comedians live on `urn:entity:person`, not the same-named artist entity (whose heatmap is empty). `filter.location` is silently ignored for brands and artists; `signal.location` is what makes a partner local. Keeping the agent *stoppable* without killing the conversation: denied and approval-required calls return a reason the model relays. Live venues carry no capacity or cost, so the capacity window and cost gate apply only where a figure exists and the card says what Qloo knows instead (primary genre, rating). Making a fully keyless path that is honest: a banner, "(synthetic)" on every fixture name, and a Qloo failure that fails loudly instead of falling back.

*Accomplishments that we're proud of*
The counterfactual: the same tour routed by metro size next to the one routed by taste, with the swapped cities, the affinity delta and the openers only Qloo finds - the answer to "would this work the same without Qloo?" is a table. The whole plan is explainable end to end (every card carries Qloo's explainability, every city its taste lift, every request its redacted provenance). Policy as data with an audit log a tour manager can read. A share link that opens the finished plan with no agent run, and prints as a promoter brief. One code path for fixtures and the live key.

*What we learned*
Qloo's affinity + explainability turn "where should we play" from a gut call into a ranked, defensible list, and once "what may the agent decide alone" is explicit data, the LLM part gets small and safe.

*What's next*
Venue availability and holds, per-market ticket-price suggestions from brand/price-level signals, multi-act package tours, and promoter accounts with saved policies.

**Built with** (tags)
`qloo`, `qloo-insights-api`, `vercel-ai-sdk`, `next.js`, `react`, `typescript`, `ag-grid`, `leaflet`, `openstreetmap`, `gemini`, `groq`, `zod`, `vitest`, `vercel`

**Try it out** links
- Live demo: `https://<tour-router>.vercel.app` (to deploy; no sign-in; with `QLOO_API_KEY` set the badge says `data: Qloo live`, otherwise a synthetic-fixtures banner)
- Three share links (music: Khruangbin / comedy: John Mulaney / counterfactual: Bad Bunny) to paste as `https://<tour-router>.vercel.app` + the paths in `docs/share-links.local.md` (git-ignored; regenerate with `npx vitest run --config scripts/vitest.live.config.mts scripts/agent-live.live.ts`). They open the finished plans with no agent run and no LLM quota.
- GitHub: `https://github.com/vigohan95/tour-router` (make public; MIT visible in About)

**Video**: YouTube, Public, under 3:00 (section B).

**Image gallery** (1280x720 PNGs in `docs/screenshots/`, captured from the running app in live mode with `scripts/screenshots.py`; Khruangbin, real Qloo data, names and percentages only)
1. `01-markets-grid-taste-lift.png` - ranked markets with fan affinity, taste lift, size rank, listeners
2. `02-partner-cards-explainability.png` - venue / opener / brand per city with Qloo explainability chips
3. `03-map-itinerary.png` - Leaflet map with the routed, dated stops
4. `04-approval-card.png` - "8 stops is over your 6-city cap" approval card citing `maxCities`
5. `05-counterfactual-population.png` - what taste changed vs population-only routing (swaps, affinity delta, km)
6. `06-why-denver.png` - "Why Denver?" answer (rank by taste vs size, heatmap cells, explainability, route position)
7. `07-audit-log.png`, `08-qloo-calls.png` - decisions with the policy field; every Qloo request, ids redacted
8. `09-shared-tour-page.png` - the read-only share page / promoter brief
Also `00-studio-live.png` (first screen with real acts as suggestions).

**Hackathon-specific fields**
- *New or existing*: New (started 2026-10-09, inside the submission period).
- *Team*: solo.

## B. Demo video plan (target 2:45, hard cap 2:58)

Record with the live key (the fixture badge must not be on screen). Same tooling as Chaser: `scripts/make_video.py` (Playwright headless Chromium 1920x1080 + edge-tts narration + ffmpeg); port it from `../paypal-chaser/scripts/make_video.py` once the key arrives.

| Time | Shot | Voice-over |
|---|---|---|
| 0:00-0:06 | Title card | "Tour Router: an agent that routes a tour by taste, with Qloo." |
| 0:06-0:30 | Type the brief; chips: resolve act, rank markets; AG Grid fills with ranked cities | "Give it an act and a brief. It resolves the act on Qloo, then scores every candidate city with Qloo's heatmap for that act's audience. These are not ticket counts; this is where the fans are." |
| 0:30-1:00 | Partner cards for the top city; hover explainability | "For each city it asks Qloo Insights, with explainability on, for the music venue whose crowd overlaps the act's fans inside my capacity window, a brand the audience over-indexes on, and a trending local opener. Every number on the card is Qloo's." |
| 1:00-1:20 | Map + itinerary fill; export CSV | "It routes the cities, spaces the dates by my policy, and exports the run sheet." |
| 1:20-1:45 | Ask for 8 cities with max 5 in policy; approval card; approve | "The policy is data. Ask for more cities than it allows and the agent stops and asks, citing the rule." |
| 1:45-2:05 | Tick exclude on a city; the agent re-plans; audit log | "Exclude a market in the grid, it re-plans, and the audit log names the policy field behind every decision." |
| 2:05-2:25 | "Why Denver?" | "Ask why, and it answers from the heatmap rank, the affinity scores and the route position." |
| 2:25-2:45 | README architecture, repo + live URL | "Qloo Insights, an AI SDK agent, a policy engine, AG Grid and a map. Open source, no keys needed to try it." |

## C. What the user must do (in order)

1. **Qloo hackathon API key** (if not yet received): form at https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key, key arrives by email (check spam), only works on `hackathon.api.qloo.com`. Paste it to Claude in the session (not into the repo).
2. **Join the hackathon on Devpost**: https://qloo.devpost.com/ -> Join hackathon (Cloudflare check needs a human).
3. **Vercel import** (once Claude says the repo is public): https://vercel.com/new -> import `vigohan95/tour-router` -> add env `QLOO_API_KEY` (Production) and `GOOGLE_GENERATIVE_AI_API_KEY` from https://aistudio.google.com/apikey -> Deploy. Tell Claude the URL.
4. **YouTube upload** of `video/tour-router-demo.mp4` (Public) when Claude says the cut is ready.
5. **Devpost submit**: Claude pre-fills the draft; the user ticks the eligibility box and presses Submit.

## D. Claude's remaining work (no user needed)

- (done 2026-10-13) live validation, ranking method, venue tags, explainability parsing, comedian path, counterfactual, share page, provenance panel, gallery stills (docs/screenshots/), LIVE-NOTES.
- Optional (video is not required by this hackathon): port `make_video.py` and record against the deployed site.
- Flip the repo to public (`gh repo edit vigohan95/tour-router --visibility public`), confirm MIT shows in About.
- Pre-fill the Devpost draft form via JS in the user's Chrome (same technique as PayPal/GitLab), leaving the eligibility checkbox and Submit to the user.

Status log
- 2026-10-10: code complete on fixtures (7 commits), 47 tests green, typecheck clean. Blocked on the Qloo key for live validation, video and deploy. This kit written.
- 2026-10-13: key received; live-verified (~140 requests, no 429 at the paced rate); ranking switched to one heatmap per country binned to cities; taste lift + counterfactual (`compare_plans`), share page `/t/<payload>`, provenance panel, fixture banner + "(synthetic)" suffixes, Qloo-error banner, default maxCities 6, real-act suggestions, cache warm-up; 58 tests green; gallery stills captured; three share links generated. Remaining: user steps C.2-C.5 (Devpost join, Vercel deploy with `QLOO_API_KEY` [+ `QLOO_WARM=1`], submit). LLM mode untested live (no model key).
