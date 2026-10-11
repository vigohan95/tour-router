# Submission kit - Qloo Agentic Hackathon (Devpost)

Deadline: **2026-10-30 23:45 ET** (= 2026-10-31 03:45 UTC). Judging Nov 2-16, winners ~Nov 23. Prize pool $25,000 (3 cash prizes; exact split is on the Devpost prize tab, which sits behind a Cloudflare check and could not be read on 2026-10-10).
Repo: https://github.com/vigohan95/tour-router (**private today; must be public with the MIT file visible in About before submitting**).

Rules that bind us (from the Official Rules text stored in the ledger, opp 526):
- Working software that integrates the Qloo API and is agentic (ours: AI SDK 7 agent loop with five Qloo tools behind a policy gate).
- Must provide a **functional demo link** + **public repo** with an OSS license detectable at the top of the repo page + text description.
- Hackathon key only works on `https://hackathon.api.qloo.com`; private server-side caching allowed; **never commit Qloo response data to the repo** (our cache is in-memory only; fixtures are synthetic by hash, not Qloo data).
- Judges may judge from text/images/video alone, so the video and gallery carry the argument.
- Judging criteria: not readable today (Devpost pages 403/Cloudflare). Last year's Qloo LLM Hackathon used: intelligent use of LLMs, integration with Qloo's API, technical implementation, originality, real-world potential. Re-check once the user has a Devpost session open.

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
Tour Router plans a tour from taste. Type an act and a brief ("Route Max Ortega through 6 cities starting in Chicago in March 2027"); the agent resolves the act with Qloo `/search`, scores every candidate city with a Qloo heatmap for that act (mean of the strongest cells), then for each chosen city asks Qloo Insights, with `feature.explainability=true`, for the music venue whose crowd most overlaps the act's fans (inside the policy's capacity window), a co-promotion brand the audience over-indexes on, and a trending local opener (`bias.trends=high`, the act excluded). It routes the cities (nearest neighbour + 2-opt), spaces show dates by policy and exports CSV / JSON / Markdown. Every partner card shows Qloo's explainability contributions, and "Why Denver?" answers from the heatmap rank, the affinity scores and the route position. The policy (max cities, budget per city, capacity window, excluded cities, regions) is data: over the cap or the budget the agent stops and shows an approval card; excluded cities are refused; every decision lands in an audit log naming the policy field it was made on. The UI is the same pipeline, clickable: act search, AG Grid of ranked markets (tick to exclude, edit the stop number to re-order), partner cards, Leaflet map, itinerary, audit log.

*How we built it*
- Qloo: a typed adapter over `/search`, `/v2/insights` (`urn:entity:place` + `urn:tag:genre:place:music_venue`, `urn:entity:brand`, `urn:entity:artist`), and `filter.type=urn:heatmap` per city, all against `https://hackathon.api.qloo.com` with the key in `X-Api-Key`; query building, parsing, a private in-memory cache (nothing on disk, nothing in the repo), a rate limiter and typed errors. A synthetic fixture adapter implements the same interface (deterministic from a hash of the request, clearly labelled "synthetic fixture" everywhere) so the product and the tests run with no key.
- Agent: Vercel AI SDK 7 agent loop (`streamText`, multi-step tools, `toolApproval`) with five Qloo tools plus `exclude_city`; a pure policy engine evaluates each call (allow / approve / deny) and cites the rule; the system prompt carries the policy and the current plan. Gemini (AI Studio) or Groq free tiers, behind per-visitor and global daily caps; past the cap, a keyless rule planner that implements `LanguageModelV3` drives the same tools, so the hosted demo never dies and the test suite exercises the real loop.
- UI: Next.js 16 App Router, React 19, AG Grid Community (ranked markets with inline exclude / re-order, cell flash on re-rank), Leaflet + OpenStreetMap, Tailwind. Client-carried state snapshot, so the hosted demo is serverless-safe and each visitor plans in isolation.
- 47 vitest tests: adapter and live-client query building, routing, policy, tools, agent loop, exports, quota.

*Challenges we ran into*
Turning a heatmap into a city score (we take the mean of the top-10 cells; we are validating it against live data and may switch to locality insights). Keeping the agent *stoppable* without killing the conversation: denied and approval-required calls return a reason the model relays. Venue capacity and cost are only present when Qloo returns them, so the policy's capacity window and cost gate are applied only when a figure exists, and the card says so. Making a fully keyless path that is honest: every surface labels synthetic data as synthetic.

*Accomplishments that we're proud of*
The whole plan is explainable end to end: each city, venue, brand and opener card carries Qloo's explainability numbers, and the itinerary cites them. Policy as data with an audit log a tour manager can read. A product that runs with zero keys and the same code path with the hackathon key.

*What we learned*
Qloo's affinity + explainability turn "where should we play" from a gut call into a ranked, defensible list, and once "what may the agent decide alone" is explicit data, the LLM part gets small and safe.

*What's next*
Venue availability and holds, per-market ticket-price suggestions from brand/price-level signals, multi-act package tours, and promoter accounts with saved policies.

**Built with** (tags)
`qloo`, `qloo-insights-api`, `vercel-ai-sdk`, `next.js`, `react`, `typescript`, `ag-grid`, `leaflet`, `openstreetmap`, `gemini`, `groq`, `zod`, `vitest`, `vercel`

**Try it out** links
- Live demo: `https://<tour-router>.vercel.app` (to deploy; no sign-in; with `QLOO_API_KEY` set the badge says `data: Qloo (hackathon API)`, otherwise `synthetic fixtures`)
- GitHub: `https://github.com/vigohan95/tour-router` (make public; MIT visible in About)

**Video**: YouTube, Public, under 3:00 (section B).

**Image gallery** (1280x720 PNGs, capture from the running app with the live key)
1. Ranked markets grid for a real act with heatmap scores and the exclude/re-order columns
2. Partner cards for one city: venue / brand / opener with Qloo explainability bars
3. Leaflet map with the routed itinerary and dated stops
4. Approval card: "7 cities requested, policy max is 5", citing `routing.maxCities`
5. Audit log with allowed / approved / denied rows and the policy field column
6. "Why <city>?" answer in the agent drawer

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

- With the key: validate heatmap-to-city aggregation against live data (vs `urn:entity:locality`); check venue `properties` coverage (capacity/cost) on real places; tune `bias.trends` opener query; make sure no Qloo payload is logged or cached to disk.
- Port `make_video.py`, record against the deployed site, write captions and gallery stills.
- Flip the repo to public (`gh repo edit vigohan95/tour-router --visibility public`), confirm MIT shows in About.
- Pre-fill the Devpost draft form via JS in the user's Chrome (same technique as PayPal/GitLab), leaving the eligibility checkbox and Submit to the user.

Status log
- 2026-10-10: code complete on fixtures (7 commits), 47 tests green, typecheck clean. Blocked on the Qloo key for live validation, video and deploy. This kit written.
