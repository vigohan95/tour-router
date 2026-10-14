# Submission kit - Qloo Agentic Hackathon (Devpost)

Deadline: **2026-10-30 23:45 ET** (= 2026-10-31 03:45 UTC). Judging Nov 2-16, winners ~Nov 23. Prize pool $25,000 (3 cash prizes; exact split is on the Devpost prize tab, which sits behind a Cloudflare check and could not be read on 2026-10-10).
Repo: https://github.com/vigohan95/tour-router (**private today; must be public with the MIT file visible in About before submitting**).
State (2026-10-13, evening): live-verified against hackathon.api.qloo.com (docs/LIVE-NOTES.md), 93 tests green, gallery stills 00-14 in docs/screenshots/, deployed at https://tour-router.vercel.app, Devpost submitted (editable until 2026-10-30). Differentiation moves 1-5 from COMPETITORS-qloo-tour-cluster-2026-10-13.md shipped: policy fields for holds / blackouts / radius clause, tour opener + co-bill heatmap, policy-B counterfactual, governed share page, "why not", demographics card.

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
`Routes a tour inside your rules, shows what taste data changed`
(60 chars. Long form, used in the README title line and the page metadata: "Routes a tour inside the promoter's own rules, and shows what the taste data changed." Seven competitors use a "where the fans are" sentence; this one names the two things none of them has: a promoter-written policy and a counterfactual that varies the rules.)

**About the project** (v2, 2026-10-13; also at modules/bounties/hackathons/qloo-tour-router/DEVPOST-ABOUT-v2.md; ~1,080 words)

*Inspiration*

A promoter routing a tour works from last tour's ticket counts, a venue calendar full of holds and blackout dates, a radius clause in every contract, and whoever the booking agent knows in each market. Qloo knows the other half: which cities' audiences over-index on an act, which venue's crowd overlaps those fans, which local brand they share, which act is trending with the same audience. We saw twenty tools that chain Qloo's answers into a route. None let the promoter write the rules the route must obey, none picked one support act for the whole run, and every counterfactual compared data sources, never rules. Tour Router routes a tour inside the promoter's own rules, and shows what the taste data changed.

*What it does*

You write the routing policy as data: city cap, budget per city, excluded cities, regions, capacity window, days between shows, blackout dates, held venues (city, venue, date), a radius clause (minimum km between any two stops) and a per-leg cap. Then you give it a brief: "Plan an 8-city North American tour for Khruangbin starting in Austin in March 2027".

The agent resolves the act with Qloo `/search` (musicians as artist entities, comedians as person entities, because the comedian's heatmap lives on the person), reads ONE Qloo heatmap per country and scores every candidate city from the cells within 60 km (fan affinity, listener density, and a taste lift = size rank minus taste rank: Denver +21, Portland +24, New York -6). For each city it asks Qloo Insights with explainability for a venue whose crowd overlaps the fans, a brand both audiences over-index on, and a trending local opener. Then it routes, inside the policy: dates skip blackout days, held venues pin their city to their date and show HELD, and two stops inside the radius clause are refused with the pair and the field named. Over the cap it stops with an approval card ("8 stops is over your 6-city cap"). Every decision lands in an audit log citing the policy field.

Then the two things nobody else does. **A tour opener and the co-bill markets**: from the per-city opener lists, the act that recurs across the routed stops becomes the opener for the whole run (locals stay as alternates), and one more heatmap per country is signalled by headliner and opener together, so every city shows its co-bill affinity next to the headliner-only one. For Khruangbin + SAULT the pairing lifts Seattle #7 -> #3 and New York #8 -> #4 and costs Denver #2 -> #8; the co-bill route swaps Denver and Austin for Seattle and New York. **Two counterfactuals on identical routing**: the obvious route (the same number of stops by metro size, what a model with no taste data picks: New York, Chicago, Dallas, Houston out; Denver, San Francisco, Portland, Vancouver in; +5 pts affinity, -2,085 km) and policy B, the same brief with one rule changed (cap 6 -> 8, a city excluded, a 300 km radius, a blackout), rebuilt from the cached ranking with the decisions that flip: "Build a 6-stop itinerary: allowed under A, denied under B [minKmBetweenStops]". "Why Denver?" answers from the data; "Why not Chicago?" answers from the rank, the obvious route and the policy. A Qloo demographics card shows the act's over/under-index by age and gender, labelled as exactly that. The share link carries the plan, the policy snapshot and the audit decisions in the URL and prints as a promoter brief: "Rules this route obeyed" and "Where the agent asked, and where it was refused".

*How we built it*

Qloo: a typed adapter over `/search` (artist + person), `/v2/insights` for `urn:entity:place` (with the venue tags that actually exist), `urn:entity:brand`, `urn:entity:artist`, `urn:entity:person` (with `signal.location.query`, `bias.trends`, `feature.explainability`), `urn:heatmap` per country with one or two signal entities, and `urn:demographics`, all against `hackathon.api.qloo.com` with a private in-memory cache, 350 ms pacing, two in flight, bounded retries, typed errors that surface as a banner (fixtures are never substituted). A synthetic fixture adapter implements the same interface so the product and the tests run with no key.

Agent: Vercel AI SDK 7 loop (`streamText`, multi-step tools, `toolApproval`) with seven tools; a pure policy engine evaluates each call (allow / approve / deny) and cites the rule; the same evaluation runs under policy A and B for the counterfactual. Gemini or Groq free tiers behind daily caps; past the cap a keyless rule planner that implements `LanguageModelV3` drives the same tools.

UI: Next.js 16, React 19, AG Grid (ranked markets with co-bill columns, inline exclude / re-order), Leaflet, Tailwind; client-carried state so each visitor plans in isolation on Vercel. 93 vitest tests across 15 files.

*Challenges we ran into*

Turning a heatmap into a city score: Qloo normalises affinity inside the queried area, so per-city heatmaps all peak at 1.0; one heatmap per country binned to cities ranks on one scale (measured in docs/LIVE-NOTES.md). Whether a heatmap accepts two signals: it does, and the joint map is neither the headliner map nor the mean of two single maps; the averaged fallback exists, labelled, and was not needed live. Opener affinities are flat (82-83%), so the tour opener is carried by how many stops an act recurs in, with the runners-up one click away. Scheduling around holds: free stops take the next dates in route order, never on a blackout and never within the gap of a held date, then the itinerary is ordered by date. Keeping the share link short enough to carry a policy and an audit log: the payload trims itself to a 7,500-character budget and says what it left out.

*Accomplishments that we're proud of*

A promoter can hand the agent a radius clause, three holds and a blackout week and get a route that obeys them, with an audit line for every decision. A tour opener chosen from the data, and cities ranked on the pairing. Two counterfactuals that answer different questions: what did Qloo change, and what would my own rule change. One code path for fixtures and the live key, and live measurements in the repo.

*What we learned*

The agent gets small and safe once "what may it decide alone" is explicit data; the interesting work moves into the policy engine and the counterfactuals. Qloo's two-signal heatmap is a real co-bill signal, not a blend.

*What's next*

Venue avails from the venues themselves, per-stop pitch emails, a per-city budget as a policy field, package tours with three acts, and promoter accounts with saved policies.

**Built with** (tags)
`qloo`, `qloo-insights-api`, `vercel-ai-sdk`, `next.js`, `react`, `typescript`, `ag-grid`, `leaflet`, `openstreetmap`, `gemini`, `groq`, `zod`, `vitest`, `vercel`

**Try it out** links
- Live demo: `https://<tour-router>.vercel.app` (to deploy; no sign-in; with `QLOO_API_KEY` set the badge says `data: Qloo live`, otherwise a synthetic-fixtures banner)
- Three share links (music: Khruangbin / comedy: John Mulaney / counterfactual: Bad Bunny) to paste as `https://<tour-router>.vercel.app` + the paths in `docs/share-links.local.md` (git-ignored; regenerate with `npx vitest run --config scripts/vitest.live.config.mts scripts/agent-live.live.ts`). They open the finished plans with no agent run and no LLM quota.
- GitHub: `https://github.com/vigohan95/tour-router` (make public; MIT visible in About)

**Video**: https://youtu.be/3nHOC1PNQVA (unlisted, 2:38, uploaded 2026-10-13).

**Image gallery** (1280x720 PNGs in `docs/screenshots/`, captured from the running app in live mode with `scripts/screenshots.py`; Khruangbin, real Qloo data, names and percentages only)
1. `01-markets-grid-taste-lift.png` - ranked markets with fan affinity, taste lift, size rank, listeners
2. `02-partner-cards-explainability.png` - venue / opener / brand per city with Qloo explainability chips
3. `03-map-itinerary.png` - Leaflet map with the routed, dated stops
4. `04-approval-card.png` - "8 stops is over your 6-city cap" approval card citing `maxCities`
5. `05-counterfactual-population.png` - what taste changed vs population-only routing (swaps, affinity delta, km)
6. `06-why-denver.png` - "Why Denver?" answer (rank by taste vs size, heatmap cells, explainability, route position)
7. `07-audit-log.png`, `08-qloo-calls.png` - decisions with the policy field; every Qloo request, ids redacted
8. `09-shared-tour-page.png` - the read-only share page / promoter brief
9. `11-policy-holds.png` - the policy panel with a held venue, blackout dates and a radius clause
10. `12-tour-opener-cobill.png` - tour opener (SAULT, 6/6 stops) and the co-bill markets table (headliner-only vs joint heatmap)
11. `13-policy-counterfactual.png` - "Compare under policy B" (radius clause 200 -> 500 km) with the decisions that flip
12. `14-why-not.png` - "Why not Chicago?" answered from the rank, the obvious route and the policy
Also `00-studio-live.png` (first screen with real acts as suggestions). Devpost gallery order for v2: 11, 12, 13, 04, 05, 01, 02, 14, 09 (policy gate first, co-bill second, counterfactuals third; the taste-lift grid and partner cards after, since three or more competitors show the same).

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
- 2026-10-13 (evening, after the competitor scan): policy fields for the promoter's own inputs (blackoutDates, heldVenues, minKmBetweenStops default 160, maxKmPerLeg) with scheduler + engine denials; tour opener from the intersection of per-city opener lists + one two-signal heatmap per country (live: the API accepts two ids; Khruangbin + SAULT and John Mulaney + Colin Jost measured in LIVE-NOTES); compare_plans against="cobill" and against="policy" (one field changed, decisions that flip); share payload v2 (policy snapshot + newest 30 audit decisions under a 7,500-char budget, v1 links still open); "Why not X?" in chat and grid; urn:demographics audience card; tagline + README first screen rewritten around the policy gate, the co-bill ranking and the two counterfactuals; "unique" claims for taste lift / heatmap-per-country / provenance / share links dropped. 93 tests. A client component had pulled node:async_hooks into the browser bundle (Vercel builds failed between the policy-B commit and the fix); fixed and redeployed. **User to do on Devpost (editable until 10-30): paste the v2 tagline and About text, upload 11-14 to the gallery in the order above.** No new video (the 10-13 cut still matches the product; the new panels are not in it).
