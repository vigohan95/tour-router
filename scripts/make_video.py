#!/usr/bin/env python3
"""
Produce the Devpost demo video for Tour Router without a camera, a microphone or paid tools.

Pipeline (all free / open source; ported from the Chaser hackathon kit):
  1. narrate   edge-tts renders one MP3 per shot from the voice-over in SHOTS (Microsoft neural voice, no key).
  2. record    Playwright (headless Chromium) drives the real UI in LIVE mode and captures frames through the CDP
               screencast with wall-clock timestamps; a fake cursor and a caption strip are injected into the page.
               The viewport is 1600x900 and the frames are upscaled 1.2x to 1920x1080 at encode time so the UI's
               12 px text reads at 1080p (the screencast is CSS-pixel sized, so a higher DPR would not help).
  3. assemble  ffmpeg turns the frames into H.264 segments (one per shot), adds a 3 s title card and a 3 s end card,
               muxes the narration (padded to each shot) as AAC, and writes the SRT + a 1280x720 thumbnail.
  4. verify    ffprobe duration <= 178 s (Devpost: under 3:00), audio stream present, sampled frames are not black.

Requirements: Python 3.11+, `pip install playwright edge-tts` + `python -m playwright install chromium`, and
ffmpeg/ffprobe on PATH (or FFMPEG=/path/to/ffmpeg). On Windows run with PYTHONUTF8=1.

The app must be running in live mode (QLOO_API_KEY in .env.local): the script refuses to record if the header badge
does not say "data: Qloo live" or if the synthetic-fixtures banner is on screen. A production build is the stable
choice for recording (`npm run build && npm run start -- -p 3200`); warm the private cache first with
`curl -X POST http://localhost:3200/api/warm` so the agent run on camera is served from memory.

Usage:
  python scripts/make_video.py                      # everything, against http://localhost:3200
  python scripts/make_video.py --url https://<deployed>.vercel.app
  python scripts/make_video.py --step assemble      # re-cut from the frames/narration already on disk
  python scripts/make_video.py --voice en-US-AvaNeural --rate -5%

Outputs (video/, git-ignored): tour-router-demo.mp4, tour-router-demo.srt, tour-router-demo-thumb.png, shots.json, stills/.
No Qloo response body is written anywhere: the frames show names and percentages, like the gallery stills.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEFAULT_URL = "http://localhost:3200"
REPO_URL = "https://github.com/vigohan95/tour-router"
BRIEF = "Plan an 8-city North American tour for Khruangbin starting in Austin in March 2027"
FPS = 30
HARD_CAP = 178.0  # seconds (Devpost: under 3:00; SUBMIT.md section B: hard cap 2:58)
CARD_SECONDS = 3.0
NARRATION_LEAD = 0.35  # narration starts this long after the shot's first frame
SHOT_TAIL = 0.6  # every shot runs at least narration + this
VIEW_W, VIEW_H = 1600, 900  # recording viewport (CSS px); upscaled to OUT_W x OUT_H at encode time
OUT_W, OUT_H = 1920, 1080
CAP_H = 44  # caption strip height (CSS px)

# ----------------------------------------------------------------------------------------------------------
# Shot list: (key, caption title, voice-over). Order follows the page top to bottom after the plan is built so the
# scroll is linear; content follows SUBMIT.md section B. Every claim is something that is on screen in live mode.
# ----------------------------------------------------------------------------------------------------------
SHOTS_ALL: list[tuple[str, str, str]] = [
    ("studio", "Live studio: real acts from Qloo /search", "Tour Router plans a tour from taste, with Qloo. The live studio: real acts from Qloo search, a routing policy written as data, and an agent that works inside it."),
    ("brief", "Brief -> /search, one heatmap per country", "Give it a brief. It resolves Khruangbin with Qloo search, then reads one Qloo heatmap per country, United States, Canada, Mexico, and scores every candidate city from the cells within sixty kilometres, all on one scale."),
    ("approval", "Policy gate: 8 stops over a 6-city cap", "The brief asks for eight cities; my policy caps it at six. The agent stops with an approval card that cites the rule, max cities. I approve."),
    ("markets", "Ranked markets with taste lift", "Fan affinity is Qloo's heatmap signal. Taste lift is size rank minus taste rank: Denver plus twenty-one, Portland plus twenty-four, New York minus six. Where the fans are, not where the people are."),
    ("map", "Routed stops: nearest neighbour + 2-opt", "It routes the stops, nearest neighbour then two-opt. Amber is the route."),
    ("partners", "Partners per city: Qloo Insights + explainability", "For each stop, Qloo Insights with explainability on: a venue whose crowd overlaps the fans, a brand both the city and the fans over-index on, and a trending local opener, the act excluded. The chips are Qloo's own scores."),
    ("itinerary", "Itinerary: dates by policy, CSV / JSON / Markdown", "The itinerary spaces the dates by policy, one venue, opener and brand per stop, and exports as CSV, JSON or Markdown."),
    ("counterfactual", "What did taste change? vs population-only", "Then the real question: what did Qloo change? The same tour by metro population alone picks the biggest cities. Taste swaps in the markets that over-index on the act: higher average affinity, more kilometres, and openers a language model alone has no data for."),
    ("why", "Why Denver?", "Ask why, and it answers from the data: taste rank against size rank, the heatmap cells behind the score, and the route position."),
    ("calls", "Provenance: Qloo calls + audit log", "Every Qloo request is listed: search, heatmaps, Insights for places, brands and artists, ids redacted, cache hits counted. And every decision lands in an audit log naming the policy field."),
    ("share", "Share link: promoter brief", "A share link opens the plan as a promoter brief: no agent run, no key, printable."),
    ("closing", "One agent, taste data, your policy", "Qloo search, heatmaps and Insights with explainability. An AI SDK agent loop behind a policy gate, driven here by the keyless rule planner. AG Grid, Leaflet, Next.js. Open source on GitHub."),
]
SHOT_KEYS = [s[0] for s in SHOTS_ALL]
SHOTS = [(s[1], s[2]) for s in SHOTS_ALL]

# ----------------------------------------------------------------------------------------------------------
# ffmpeg discovery
# ----------------------------------------------------------------------------------------------------------


def find_tool(name: str) -> str:
    env = os.environ.get(name.upper())
    if env and Path(env).exists():
        return env
    on_path = shutil.which(name)
    if on_path:
        return on_path
    for root in (REPO / "tools" / "ffmpeg", REPO.parents[2] / "tools" / "ffmpeg" if len(REPO.parents) > 2 else None):
        if root and root.exists():
            for p in root.rglob(f"{name}.exe" if os.name == "nt" else name):
                return str(p)
    sys.exit(f"{name} not found. Install ffmpeg (winget install Gyan.FFmpeg) or set {name.upper()}=path")


FFMPEG = find_tool("ffmpeg")
FFPROBE = find_tool("ffprobe")


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:], file=sys.stderr)
        raise SystemExit(f"command failed ({r.returncode}): {' '.join(cmd[:4])} ...")
    return r


def media_duration(path: Path) -> float:
    out = run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).stdout.strip()
    return float(out)


# ----------------------------------------------------------------------------------------------------------
# 1. Narration
# ----------------------------------------------------------------------------------------------------------


def vo_path(work: Path, shot_key: str) -> Path:
    return work / "vo" / f"vo-{shot_key}.mp3"


def narrate(work: Path, voice: str, rate: str) -> list[float]:
    import edge_tts  # type: ignore
    import edge_tts.communicate as communicate  # type: ignore
    from edge_tts.constants import TRUSTED_CLIENT_TOKEN  # type: ignore

    # Since 2026-10-10 the legacy speech.platform.bing.com host answers 403 (rany2/edge-tts#490); Edge 155 synthesises
    # through api.msedgeservices.com, which accepts the same token as Ocp-Apim-Subscription-Key (upstream PR #491).
    # Patch the module the websocket is opened from, not constants.py. Drop this once edge-tts > 7.2.8 ships the fix.
    if "msedgeservices" not in communicate.WSS_URL and os.environ.get("EDGE_TTS_LEGACY") != "1":
        communicate.WSS_URL = f"wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key={TRUSTED_CLIENT_TOKEN}"

    vo_dir = work / "vo"
    vo_dir.mkdir(parents=True, exist_ok=True)

    async def render() -> None:
        for shot_key, (_, text) in zip(SHOT_KEYS, SHOTS):
            out, stamp = vo_path(work, shot_key), vo_path(work, shot_key).with_suffix(".txt")
            key = f"{voice}|{rate}|{text}"
            if out.exists() and out.stat().st_size > 0 and stamp.exists() and stamp.read_text(encoding="utf-8") == key:
                continue  # cached from a previous run with the same voice, rate and text
            for attempt in range(1, 6):  # the free endpoint occasionally answers 403 on the websocket handshake
                try:
                    await edge_tts.Communicate(text, voice, rate=rate).save(str(out))
                    break
                except Exception as e:  # noqa: BLE001
                    if attempt == 5:
                        raise
                    print(f"  narration {shot_key}: retry {attempt} after {type(e).__name__}: {str(e)[:80]}")
                    await asyncio.sleep(2.0 * attempt)
            stamp.write_text(key, encoding="utf-8")

    asyncio.run(render())
    durations = [media_duration(vo_path(work, k)) for k in SHOT_KEYS]
    for i, d in enumerate(durations, 1):
        print(f"  narration {i}: {d:5.2f}s  {SHOTS[i-1][0]}")
    print(f"  narration total: {sum(durations):.1f}s")
    return durations


# ----------------------------------------------------------------------------------------------------------
# 2. Recording (Playwright + CDP screencast)
# ----------------------------------------------------------------------------------------------------------

OVERLAY_JS = r"""
(caption) => {
  if (!document.getElementById('demo-style')) {
    const s = document.createElement('style'); s.id = 'demo-style';
    s.textContent = `
      aside.card { height: calc(100vh - 80px - 44px) !important; }
      nextjs-portal { display: none !important; }
      #demo-cap { position: fixed; left: 0; right: 0; bottom: 0; height: 44px; background: #0f172a; color: #fff;
        font: 500 15px/1 ui-sans-serif, system-ui, "Segoe UI", sans-serif; display: flex; align-items: center;
        padding: 0 20px; gap: 14px; z-index: 2147483646; letter-spacing: .01em; }
      #demo-cap .b { font-weight: 700; } #demo-cap .m { opacity: .55; } #demo-cap .r { margin-left: auto; opacity: .7; font-size: 13px; }
      #demo-cur { position: fixed; left: 0; top: 0; width: 24px; height: 24px; z-index: 2147483647; pointer-events: none;
        transform: translate(-100px,-100px); transition: transform 16ms linear; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.5)); }
      .demo-ripple { position: fixed; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
        border: 3px solid #b45309; opacity: .9; pointer-events: none; z-index: 2147483645; animation: demo-rip .5s ease-out forwards; }
      @keyframes demo-rip { from { transform: scale(.3); opacity: .9 } to { transform: scale(1.4); opacity: 0 } }
    `;
    document.head.appendChild(s);
    const cap = document.createElement('div'); cap.id = 'demo-cap';
    cap.innerHTML = '<span class="m">Tour Router demo</span><span class="b" id="demo-cap-text"></span><span class="r">github.com/vigohan95/tour-router  ·  live Qloo data (hackathon.api.qloo.com)</span>';
    document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = 'demo-cur';
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 2 L3 20 L8 15.5 L11.5 22.5 L14.5 21 L11 14.5 L17.5 14.5 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    document.addEventListener('mousemove', e => { cur.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 1}px)`; }, true);
    document.addEventListener('mousedown', e => { const r = document.createElement('div'); r.className = 'demo-ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
  }
  document.getElementById('demo-cap-text').textContent = caption;
}
"""


@dataclass
class Recorder:
    page: object
    cdp: object
    frames_dir: Path
    frames: list[tuple[float, str]] = field(default_factory=list)
    shots: list[dict] = field(default_factory=list)
    pos: tuple[float, float] = (VIEW_W / 2, VIEW_H / 2)
    _n: int = 0

    # -- screencast ---------------------------------------------------------------------------------------
    def start(self) -> None:
        self.cdp.on("Page.screencastFrame", self._on_frame)
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": OUT_W, "maxHeight": OUT_H, "everyNthFrame": 1})

    def _on_frame(self, ev: dict) -> None:
        self._n += 1
        path = self.frames_dir / f"f{self._n:06d}.jpg"
        path.write_bytes(base64.b64decode(ev["data"]))
        self.frames.append((float(ev["metadata"]["timestamp"]), path.name))
        self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})

    def stop(self) -> None:
        try:
            self.cdp.send("Page.stopScreencast")
        except Exception:
            pass

    # -- pacing (always through Playwright so screencast events keep flowing) -------------------------------
    def pause(self, seconds: float) -> None:
        self.page.wait_for_timeout(int(seconds * 1000))

    def caption(self, text: str) -> None:
        self.page.evaluate(OVERLAY_JS, text)

    def begin(self, key: str) -> None:
        index = SHOT_KEYS.index(key) + 1
        self.caption(SHOTS[index - 1][0])
        self.pause(0.25)
        self.shots.append({"key": key, "index": index, "title": SHOTS[index - 1][0], "start": time.time()})

    def end(self, min_len: float) -> None:
        shot = self.shots[-1]
        remaining = min_len - (time.time() - shot["start"])
        if remaining > 0:
            self.pause(remaining)
        shot["end"] = time.time()
        shot["seconds"] = round(shot["end"] - shot["start"], 2)
        print(f"  shot {shot['key']}: {shot['seconds']:.1f}s  {shot['title']}")

    # -- mouse ----------------------------------------------------------------------------------------------
    def move(self, x: float, y: float, dur: float | None = None) -> None:
        """Ease the cursor to (x, y) over `dur` wall-clock seconds (each step is a browser round-trip, so pace by the clock)."""
        x0, y0 = self.pos
        dist = math.hypot(x - x0, y - y0)
        if dist < 1:
            return
        dur = dur if dur is not None else min(1.0, 0.3 + dist / 1800)
        t0 = time.time()
        while True:
            t = min(1.0, (time.time() - t0) / dur)
            e = t * t * (3 - 2 * t)  # smoothstep
            self.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
            if t >= 1.0:
                break
            self.pause(0.012)
        self.pos = (x, y)

    def center(self, locator, dx: float = 0, dy: float = 0) -> tuple[float, float]:
        box = locator.bounding_box(timeout=8000)
        if not box:
            raise RuntimeError("element has no box")
        return box["x"] + box["width"] / 2 + dx, box["y"] + box["height"] / 2 + dy

    def hover(self, locator, dx: float = 0, dy: float = 0, dur: float | None = None) -> None:
        x, y = self.center(locator, dx, dy)
        self.move(x, y, dur)

    def click(self, locator, dx: float = 0, dy: float = 0, settle: float = 0.25) -> None:
        self.hover(locator, dx, dy)
        self.pause(0.12)
        self.page.mouse.down()
        self.pause(0.08)
        self.page.mouse.up()
        self.pause(settle)

    def type_text(self, locator, text: str, cps: float = 30) -> None:
        self.click(locator)
        self.page.keyboard.type(text, delay=int(1000 / cps))

    # -- app helpers ----------------------------------------------------------------------------------------
    def wait_agent_done(self, timeout: float = 180) -> None:
        stop = self.page.locator("aside button:has-text('Stop')")
        try:
            stop.wait_for(state="visible", timeout=3_000)  # a resumed run (after Approve) can finish before Stop shows
        except Exception:
            pass
        stop.wait_for(state="detached", timeout=int(timeout * 1000))

    def scroll_to(self, locator, offset: float = -12, settle: float = 0.9) -> None:
        """Smooth-scroll the window so `locator` sits near the top of the viewport (the caption strip is at the bottom)."""
        box = locator.bounding_box(timeout=8000)
        if not box:
            raise RuntimeError("element has no box")
        self.page.evaluate("(dy) => window.scrollBy({ top: dy, behavior: 'smooth' })", box["y"] + offset)
        self.pause(settle)

    def still(self, out_dir: Path, name: str) -> None:
        out_dir.mkdir(parents=True, exist_ok=True)
        self.page.screenshot(path=str(out_dir / f"{name}.png"))


def record(work: Path, out: Path, url: str, narration: list[float], headed: bool) -> list[dict]:
    from playwright.sync_api import sync_playwright  # type: ignore

    frames_dir = work / "frames"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)
    stills = out / "stills"
    need = [d + NARRATION_LEAD + SHOT_TAIL for d in narration]
    need_for = lambda key: need[SHOT_KEYS.index(key)]  # noqa: E731

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        ctx = browser.new_context(viewport={"width": VIEW_W, "height": VIEW_H}, device_scale_factor=1, color_scheme="light", locale="en-US", timezone_id="America/Los_Angeles")
        page = ctx.new_page()
        page.goto(url, wait_until="load", timeout=90_000)
        page.wait_for_selector("header:has-text('Tour Router')", timeout=60_000)
        # Live mode or nothing: the fixture badge/banner must never be on camera (SUBMIT.md section B).
        page.wait_for_selector("header .chip:has-text('data: Qloo live')", timeout=60_000)
        if page.locator("[data-banner='fixture']").count():
            raise SystemExit("The synthetic-fixtures banner is on screen; set QLOO_API_KEY and restart the server.")
        page.wait_for_timeout(1000)
        page.mouse.move(VIEW_W / 2, VIEW_H / 2)
        rec = Recorder(page=page, cdp=ctx.new_cdp_session(page), frames_dir=frames_dir)
        rec.caption("")
        rec.start()
        rec.pause(0.8)
        if not rec.frames:
            raise SystemExit("screencast produced no frames")

        agent_input = page.locator("aside form input")
        send_btn = page.locator("aside form button[type=submit]")
        approve_btn = page.locator("aside button:has-text('Approve')")
        card = page.locator("aside .border-amber-400").first
        header_btn = lambda name: page.locator(f"header button:has-text('{name}')")  # noqa: E731
        section = lambda title: page.locator(f"main :text-is('{title}')").first  # noqa: E731
        grid = page.locator("main .ag-root-wrapper").first
        grid_cell = lambda city, col: grid.locator(f".ag-row[row-id='{city}'] .ag-cell[col-id='{col}']").first  # noqa: E731
        chip = lambda text: page.locator(f"aside .chip:has-text('{text}')").last  # noqa: E731

        # ---- studio: live badge, suggestions, real acts from /search --------------------------------------
        rec.begin("studio")
        rec.hover(page.locator("header .chip:has-text('data: Qloo live')"), dur=0.7)
        rec.pause(1.0)
        rec.still(stills, "00-studio-live")
        rec.hover(header_btn("Policy"), dur=0.5)
        rec.pause(0.7)
        act_input = page.locator("main input[placeholder*='Musician']")
        rec.type_text(act_input, "Khruangbin", cps=16)
        hit = page.locator("main li:has-text('Khruangbin') button:has-text('Select')").first
        hit.wait_for(timeout=30_000)
        rec.pause(0.6)
        rec.hover(page.locator("main li:has-text('Khruangbin')").first, dx=-200, dur=0.5)
        rec.pause(0.9)
        rec.click(hit, settle=0.6)
        page.locator("main :text-is('Plan tour with the agent')").wait_for(timeout=15_000)
        rec.hover(page.locator("main span.font-semibold:has-text('Khruangbin')").first, dur=0.5)
        rec.end(need_for("studio"))

        # ---- brief: type the brief, send; Resolve act + Rank cities chips, the grid fills -------------------
        rec.begin("brief")
        rec.type_text(agent_input, BRIEF, cps=34)
        rec.pause(0.3)
        rec.click(send_btn)
        chip("Rank cities").wait_for(timeout=120_000)
        page.locator(".ag-row[row-id]").first.wait_for(timeout=120_000)
        rec.pause(0.4)
        rec.hover(chip("Resolve act"), dur=0.5)
        rec.pause(0.7)
        rec.hover(chip("Rank cities"), dur=0.4)
        rec.pause(0.8)
        rec.hover(page.locator("main .ag-header-cell[col-id='score']").first, dur=0.6)
        rec.pause(0.6)
        rec.still(stills, "01-brief-ranked")
        rec.end(need_for("brief"))

        # ---- approval: 8 stops > maxCities 6 -> card citing the rule; approve ----------------------------
        rec.begin("approval")
        approve_btn.wait_for(timeout=120_000)
        rec.pause(0.4)
        rec.hover(card.locator("p").first, dy=-2, dur=0.6)
        rec.pause(0.5)
        rec.still(stills, "02-approval-card")
        rec.pause(2.2)
        rec.click(approve_btn, settle=0.4)
        rec.wait_agent_done()
        rec.pause(0.6)
        rec.hover(chip("Build itinerary"), dur=0.5)
        rec.end(need_for("approval"))

        # ---- markets: grid with taste lift --------------------------------------------------------------
        rec.begin("markets")
        rec.scroll_to(section("2. Markets"), offset=-30)
        for city in ("Denver", "Portland"):
            rec.hover(grid_cell(city, "lift"), dur=0.6)
            rec.pause(0.9)
        ny = grid_cell("New York", "lift")
        if ny.count():
            ny.scroll_into_view_if_needed()
            rec.pause(0.3)
            rec.hover(ny, dur=0.6)
            rec.pause(0.9)
        rec.hover(page.locator("main .ag-header-cell[col-id='lift']").first, dur=0.5)
        rec.still(stills, "03-markets-taste-lift")
        rec.end(need_for("markets"))

        # ---- map ---------------------------------------------------------------------------------------
        rec.begin("map")
        rec.scroll_to(section("4. Map"), offset=-30)
        rec.hover(page.locator("main .leaflet-container").first, dx=-60, dy=-20, dur=0.8)
        rec.pause(0.5)
        rec.still(stills, "04-map")
        rec.end(need_for("map"))

        # ---- partners: cards with explainability chips --------------------------------------------------
        rec.begin("partners")
        rec.scroll_to(section("3. Partners per city"), offset=-30)
        first_card = page.locator("main .card:has(span:text-is('Qloo insights'))").first
        for tag in ("venue", "opener", "brand"):
            line = first_card.locator(f"li:has(span:text-is('{tag}'))").first
            if line.count():
                rec.hover(line, dx=-120, dur=0.5)
                rec.pause(0.8)
                ch = line.locator(".chip").first
                if ch.count():
                    rec.hover(ch, dur=0.35)
                    rec.pause(0.5)
        rec.still(stills, "05-partner-cards")
        second_card = page.locator("main .card:has(span:text-is('Qloo insights'))").nth(1)
        if second_card.count():
            rec.hover(second_card.locator("li").first, dx=-120, dur=0.5)
            rec.pause(0.5)
        rec.end(need_for("partners"))

        # ---- itinerary: dated stops, exports ------------------------------------------------------------
        rec.begin("itinerary")
        rec.scroll_to(section("5. Itinerary"), offset=-30)
        rows = page.locator("main .card:has(:text-is('5. Itinerary')) tbody tr")
        for i in range(min(3, rows.count())):
            rec.hover(rows.nth(i), dx=-300, dur=0.4)
            rec.pause(0.4)
        for name in ("CSV", "JSON", "Copy Markdown"):
            rec.hover(page.locator(f"main button:text-is('{name}')").first, dur=0.4)
            rec.pause(0.45)
        rec.still(stills, "06-itinerary")
        rec.end(need_for("itinerary"))

        # ---- counterfactual: population-only vs taste ---------------------------------------------------
        rec.begin("counterfactual")
        rec.scroll_to(section("6. What did taste change?"), offset=-30)
        panel = page.locator("[data-panel='compare']")
        if not panel.locator("table").count():
            rec.click(panel.locator("button:has-text('vs population')"), settle=0.8)
            panel.locator("table").wait_for(timeout=60_000)
        rec.hover(panel.locator(".border-red-300").first, dy=10, dur=0.6)
        rec.pause(1.3)
        rec.hover(panel.locator(".border-green-300").first, dy=10, dur=0.6)
        rec.pause(1.3)
        rec.hover(panel.locator("table tbody tr").first, dur=0.5)
        rec.pause(0.8)
        rec.hover(panel.locator("table tbody tr").nth(1), dur=0.4)
        rec.still(stills, "07-counterfactual")
        rec.pause(0.8)
        rec.hover(panel.locator("table tbody tr").nth(2), dur=0.4)
        rec.end(need_for("counterfactual"))

        # ---- why: the suggestion chip -> explain_choice ------------------------------------------------
        rec.begin("why")
        rec.click(page.locator("aside button.chip:text-is('Why Denver?')"), settle=0.3)
        rec.wait_agent_done()
        rec.pause(0.5)
        answer = page.locator("aside .prose-chat").last
        rec.hover(answer, dy=-10, dur=0.6)
        rec.still(stills, "08-why-denver")
        rec.pause(0.8)
        rec.hover(answer, dy=20, dur=0.6)
        rec.end(need_for("why"))

        # ---- calls: Qloo provenance panel + audit log ---------------------------------------------------
        rec.begin("calls")
        page.evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })")  # the header (Audit toggle) is not sticky
        rec.pause(0.9)
        rec.click(header_btn("Audit ("), settle=0.4)
        audit = page.locator("[data-panel='audit']")
        audit.wait_for(timeout=10_000)
        calls_panel = page.locator("[data-panel='qloo-calls']")
        calls_btn = calls_panel.locator("button").first
        rec.scroll_to(calls_panel, offset=-30)
        rec.click(calls_btn, settle=0.6)
        rec.scroll_to(calls_panel, offset=-30, settle=0.6)  # the panel grew; re-align it at the top
        crows = page.locator("[data-panel='qloo-calls'] table tbody tr")
        for i in range(min(4, crows.count())):
            rec.hover(crows.nth(i), dx=-250, dur=0.4)
            rec.pause(0.45)
        rec.still(stills, "09-qloo-calls")
        rec.scroll_to(audit, offset=-30)
        arows = audit.locator("li")
        for i in range(min(3, arows.count())):
            rec.hover(arows.nth(i), dx=-150, dur=0.4)
            rec.pause(0.45)
        rec.still(stills, "10-audit-log")
        rec.end(need_for("calls"))

        # ---- share: the read-only promoter brief ---------------------------------------------------------
        rec.begin("share")
        rec.scroll_to(section("5. Itinerary"), offset=-30)
        with ctx.expect_page(timeout=30_000) as popup_info:
            rec.click(page.locator("main button:has-text('Share link')"), settle=0.3)
        popup = popup_info.value
        popup.wait_for_load_state("load")
        share_url = popup.url
        popup.close()
        page.goto(share_url, wait_until="load", timeout=90_000)
        page.wait_for_selector("[data-page='shared-tour']", timeout=60_000)
        rec.caption(SHOTS[SHOT_KEYS.index("share")][0])  # the overlay does not survive navigation
        rec.pause(0.8)
        rec.hover(page.locator("[data-page='shared-tour'] h1"), dur=0.5)
        rec.pause(0.5)
        rec.hover(page.locator("button:has-text('Print brief')"), dur=0.5)
        rec.pause(0.5)
        rec.still(stills, "11-share-page")
        page.evaluate("window.scrollBy({ top: 520, behavior: 'smooth' })")
        rec.pause(1.0)
        rec.end(need_for("share"))

        # ---- closing slide -----------------------------------------------------------------------------------
        slide = work / "slide.html"
        slide.write_text(closing_slide_html(SHOTS[-1][0]), encoding="utf-8")
        rec.begin("closing")
        page.goto(slide.as_uri(), wait_until="load")
        rec.pause(1.0)
        rec.end(need_for("closing"))
        rec.pause(0.3)

        rec.stop()
        shots = rec.shots
        frames = rec.frames
        browser.close()

    if [s["key"] for s in shots] != SHOT_KEYS:
        raise SystemExit(f"Recorded shots {[s['key'] for s in shots]} but the shot list is {SHOT_KEYS}: the click sequence in record() must match the shot list / narration.")

    (work / "frames.json").write_text(json.dumps(frames), encoding="utf-8")
    (work / "shots.json").write_text(json.dumps(shots, indent=1), encoding="utf-8")
    print(f"  captured {len(frames)} frames")
    return shots


# ----------------------------------------------------------------------------------------------------------
# HTML for the title card, end card, closing slide and thumbnail
# ----------------------------------------------------------------------------------------------------------

BASE_CSS = """
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; background: #140f0a; color: #fff;
    font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .bg { position: absolute; inset: 0; background:
    radial-gradient(900px 600px at 15% 20%, rgba(217,119,6,.38), transparent 60%),
    radial-gradient(700px 500px at 85% 85%, rgba(14,116,144,.28), transparent 60%), #140f0a; }
  .mark { display: inline-grid; place-items: center; width: 72px; height: 72px; border-radius: 18px; background: #d97706;
    font-weight: 800; font-size: 40px; }
  .muted { color: rgba(255,255,255,.7); }
  .cap { position: fixed; left: 0; right: 0; bottom: 0; height: 44px; background: #0f172a; color: #fff; font: 500 15px/1 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    display: flex; align-items: center; padding: 0 20px; gap: 14px; letter-spacing: .01em; }
  .cap .b { font-weight: 700 } .cap .m { opacity: .55 } .cap .r { margin-left: auto; opacity: .7; font-size: 13px }
"""


def title_card_html() -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}
  .wrap {{ position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }}
  h1 {{ font-size: 120px; letter-spacing: -.02em; margin-top: 26px; }}
  p.tag {{ font-size: 40px; margin-top: 18px; color: rgba(255,255,255,.85); }}
  p.ev {{ font-size: 28px; margin-top: 56px; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.6); }}
  </style></head><body><div class="bg"></div><div class="wrap"><div>
  <div class="mark">T</div><h1>Tour Router</h1>
  <p class="tag">Routes an act's tour by taste: Qloo picks the cities, venues and openers.</p>
  <p class="ev">Qloo Agentic Hackathon 2026</p></div></div></body></html>"""


def end_card_html() -> str:
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}
  .wrap {{ position: absolute; inset: 0; display: grid; place-items: center; text-align: center; }}
  h1 {{ font-size: 72px; letter-spacing: -.02em; margin-top: 22px; }}
  .url {{ font-size: 48px; margin-top: 44px; font-family: ui-monospace, Consolas, monospace; color: #fcd34d; }}
  .url small {{ display: block; font-size: 22px; color: rgba(255,255,255,.55); margin-bottom: 8px; font-family: ui-sans-serif, system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; }}
  p.ft {{ font-size: 26px; margin-top: 56px; color: rgba(255,255,255,.6); }}
  </style></head><body><div class="bg"></div><div class="wrap"><div>
  <div class="mark">T</div><h1>Tour Router</h1>
  <div class="url"><small>Source (MIT)</small>{REPO_URL.replace('https://', '')}</div>
  <p class="ft">Live demo link on the Devpost page  ·  Qloo /search, heatmaps, Insights + explainability  ·  Vercel AI SDK 7  ·  AG Grid  ·  Leaflet  ·  Next.js 16</p></div></div></body></html>"""


def closing_slide_html(caption: str) -> str:
    # Rendered inside the recording viewport (1600x900), so sizes are 1/1.2 of the 1920x1080 cards.
    caps = [
        ("GET /search", "the act as an artist entity, or a person entity for comedians"),
        ("GET /v2/insights  filter.type=urn:heatmap", "one map per country, cells within 60 km of each city -> fan affinity, listeners, taste lift"),
        ("GET /v2/insights  urn:entity:place", "live_music_venue, concert_hall, amphitheater, arena ... + feature.explainability=true"),
        ("GET /v2/insights  urn:entity:brand / artist / person", "signal.location.query=<city>, bias.trends=high, the act excluded"),
        ("compare_plans", "the same tour by metro population: what taste changed, no Qloo"),
    ]
    tiles = "".join(f'<li style="animation-delay:{0.25 + i * 0.22:.2f}s"><b>{t}</b><span>{d}</span></li>' for i, (t, d) in enumerate(caps))
    flow = [
        ("Studio", "AG Grid markets · partner cards · Leaflet map · itinerary · counterfactual · audit log"),
        ("Agent loop", "Vercel AI SDK 7 streamText + toolApproval · keyless rule planner (LLM optional)"),
        ("Policy engine", "allow · ask · deny - every tool call cites the rule (maxCities, excludedCities, budget)"),
        ("Qloo adapter", "typed client, private in-memory cache, paced + retried; fixtures never substituted"),
        ("hackathon.api.qloo.com", "every request listed with ids redacted"),
    ]
    boxes = "".join(f'<div class="box" style="animation-delay:{0.6 + i * 0.3:.2f}s"><b>{t}</b><span>{d}</span></div>{"<div class=arr style=animation-delay:%.2fs>&darr;</div>" % (0.75 + i * 0.3) if i < len(flow) - 1 else ""}' for i, (t, d) in enumerate(flow))
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{BASE_CSS}
  .page {{ position: absolute; inset: 0 0 44px 0; padding: 54px 72px; display: grid; grid-template-columns: 1.1fr .9fr; gap: 56px; }}
  h1 {{ font-size: 52px; letter-spacing: -.02em; }} h1 small {{ display: block; font-size: 21px; color: rgba(255,255,255,.6); font-weight: 500; margin-top: 8px; letter-spacing: 0; }}
  ul {{ list-style: none; margin-top: 30px; display: grid; gap: 11px; }}
  li, .box {{ background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 13px 17px; opacity: 0; animation: in .5s ease-out forwards; }}
  li b, .box b {{ display: block; font-size: 19px; }} li b {{ font-family: ui-monospace, Consolas, monospace; color: #fcd34d; }}
  li span, .box span {{ display: block; font-size: 15px; color: rgba(255,255,255,.65); margin-top: 3px; }}
  .right {{ display: flex; flex-direction: column; justify-content: center; }}
  .arr {{ text-align: center; font-size: 22px; color: rgba(255,255,255,.4); line-height: 1.1; opacity: 0; animation: in .4s ease-out forwards; }}
  .box {{ border-color: rgba(252,211,77,.45); }}
  @keyframes in {{ from {{ opacity: 0; transform: translateY(10px) }} to {{ opacity: 1; transform: none }} }}
  </style></head><body><div class="bg"></div><div class="page">
  <div><h1>One agent, taste data, your policy<small>Qloo answers where the fans are, which venue, brand and opener; the agent chains it into a routed, dated, explainable tour.</small></h1><ul>{tiles}</ul></div>
  <div class="right">{boxes}</div></div>
  <div class="cap"><span class="m">Tour Router demo</span><span class="b">{caption}</span><span class="r">github.com/vigohan95/tour-router  ·  live Qloo data (hackathon.api.qloo.com)</span></div>
  </body></html>"""


def thumbnail_html(bg_png: Path) -> str:
    data = base64.b64encode(bg_png.read_bytes()).decode()
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
  * {{ box-sizing: border-box; margin: 0 }} html, body {{ width: 1280px; height: 720px; overflow: hidden; font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; color: #fff; }}
  .shot {{ position: absolute; inset: 0; background: url(data:image/png;base64,{data}) center/cover; }}
  .shade {{ position: absolute; inset: 0; background: linear-gradient(90deg, rgba(20,15,10,.96) 0%, rgba(20,15,10,.86) 42%, rgba(20,15,10,.15) 70%, rgba(20,15,10,0) 100%); }}
  .txt {{ position: absolute; left: 64px; top: 140px; width: 580px; }}
  .mark {{ display: inline-grid; place-items: center; width: 64px; height: 64px; border-radius: 16px; background: #d97706; font-weight: 800; font-size: 36px; }}
  h1 {{ font-size: 88px; letter-spacing: -.03em; margin-top: 16px; line-height: 1; }}
  p {{ font-size: 30px; margin-top: 18px; line-height: 1.25; color: rgba(255,255,255,.9); }}
  .pill {{ display: inline-block; margin-top: 28px; padding: 10px 16px; border-radius: 999px; background: rgba(255,255,255,.12); font-size: 20px; letter-spacing: .06em; text-transform: uppercase; }}
  </style></head><body><div class="shot"></div><div class="shade"></div><div class="txt"><div class="mark">T</div><h1>Tour Router</h1>
  <p>Routes an act's tour by taste: Qloo picks the cities, venues and openers.</p><span class="pill">Qloo Agentic Hackathon 2026 · demo</span></div></body></html>"""


def render_html_png(html: str, out: Path, width: int, height: int) -> None:
    from playwright.sync_api import sync_playwright  # type: ignore

    src = out.with_suffix(".html")
    src.write_text(html, encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
        pg.goto(src.as_uri(), wait_until="load")
        pg.wait_for_timeout(4000 if "animation" in html else 300)  # let CSS reveal animations finish
        jpeg = out.suffix.lower() in (".jpg", ".jpeg")
        pg.screenshot(path=str(out), type="jpeg" if jpeg else "png", **({"quality": 92} if jpeg else {}))
        b.close()


# ----------------------------------------------------------------------------------------------------------
# 3. Assembly
# ----------------------------------------------------------------------------------------------------------

X264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", str(FPS * 2), "-profile:v", "high", "-level", "4.1"]
SCALE = f"scale={OUT_W}:{OUT_H}:flags=lanczos"


def frames_for_shot(frames: list[tuple[float, str]], start: float, end: float) -> list[tuple[str, float]]:
    """(file, duration) pairs covering [start, end]; the frame on screen at `start` is carried in."""
    idx = 0
    for i, (ts, _) in enumerate(frames):
        if ts <= start:
            idx = i
        else:
            break
    seq = [frames[idx]] + [f for f in frames[idx + 1 :] if f[0] < end]
    out: list[tuple[str, float]] = []
    for i, (ts, name) in enumerate(seq):
        t0 = max(ts, start)
        t1 = seq[i + 1][0] if i + 1 < len(seq) else end
        d = min(t1, end) - t0
        if d > 0.0005:
            out.append((name, d))
    return out


def encode_frames(frames_dir: Path, seq: list[tuple[str, float]], out: Path) -> None:
    """Resample the variable-rate screencast to constant FPS by piping, for every output tick, the JPEG that was on
    screen at that instant, upscaled to the output size."""
    total = sum(d for _, d in seq)
    n_out = max(1, int(round(total * FPS)))
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "pipe:0", "-vf", f"{SCALE},format=yuv420p", "-an", *X264, str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert proc.stdin is not None
    j, end_j = 0, seq[0][1]
    last_name, data = None, b""
    for k in range(n_out):
        t = k / FPS + 1e-6
        while t >= end_j and j < len(seq) - 1:
            j += 1
            end_j += seq[j][1]
        if seq[j][0] != last_name:
            last_name = seq[j][0]
            data = (frames_dir / last_name).read_bytes()
        proc.stdin.write(data)
    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise SystemExit(f"ffmpeg failed for {out.name}: {err[-2000:]}")


def encode_card(png: Path, out: Path, seconds: float, fade_in: bool, fade_out: bool) -> None:
    vf = [f"fps={FPS}", SCALE]
    if fade_in:
        vf.append("fade=t=in:st=0:d=0.5")
    if fade_out:
        vf.append(f"fade=t=out:st={seconds - 0.5:.2f}:d=0.5")
    vf.append("format=yuv420p")
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", str(FPS), "-t", f"{seconds}", "-i", str(png), "-vf", ",".join(vf), "-an", *X264, str(out)])


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def assemble(work: Path, out: Path, narration: list[float]) -> Path:
    frames = [tuple(f) for f in json.loads((work / "frames.json").read_text(encoding="utf-8"))]
    shots = json.loads((work / "shots.json").read_text(encoding="utf-8"))
    seg_dir = work / "segments"
    seg_dir.mkdir(exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)

    # cards
    title_png, end_png = work / "title.png", work / "end.png"
    render_html_png(title_card_html(), title_png, OUT_W, OUT_H)
    render_html_png(end_card_html(), end_png, OUT_W, OUT_H)
    segments: list[tuple[Path, Path | None, int | None]] = []  # (video, narration mp3 or None, shot index)
    encode_card(title_png, seg_dir / "00-title.mp4", CARD_SECONDS, True, True)
    segments.append((seg_dir / "00-title.mp4", None, None))

    by_key = {s["key"]: s for s in shots}
    if list(by_key) != SHOT_KEYS:
        raise SystemExit(f"shots.json has {list(by_key)} but the shot list needs {SHOT_KEYS}: re-record.")
    for i, key in enumerate(SHOT_KEYS, 1):
        seg = seg_dir / f"{i:02d}-{key}.mp4"
        shot = by_key[key]
        seq = frames_for_shot(frames, shot["start"], shot["end"])
        encode_frames(work / "frames", seq, seg)
        segments.append((seg, vo_path(work, key), i))
        print(f"  segment {i} {key}: {len(seq)} frames -> {media_duration(seg):.2f}s")

    encode_card(end_png, seg_dir / "99-end.mp4", CARD_SECONDS, True, False)
    segments.append((seg_dir / "99-end.mp4", None, None))

    # audio: each segment gets a wav exactly as long as its video; narration starts NARRATION_LEAD in
    wavs: list[Path] = []
    t = 0.0
    srt: list[str] = []
    timeline: list[dict] = []
    for seg, vo, idx in segments:
        length = media_duration(seg)
        wav = seg.with_suffix(".wav")
        if vo is None:
            run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{length:.3f}", "-c:a", "pcm_s16le", str(wav)])
        else:
            delay = int(NARRATION_LEAD * 1000)
            run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(vo), "-af", f"adelay={delay}|{delay},apad", "-t", f"{length:.3f}", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(wav)])
            nd = narration[idx - 1]
            srt.append(f"{len(srt) + 1}\n{srt_time(t + NARRATION_LEAD)} --> {srt_time(t + NARRATION_LEAD + nd)}\n{SHOTS[idx - 1][1]}\n")
            timeline.append({"shot": idx, "title": SHOTS[idx - 1][0], "start": round(t, 2), "end": round(t + length, 2), "video_s": round(length, 2), "narration_s": round(nd, 2)})
        wavs.append(wav)
        t += length
    timeline.insert(0, {"shot": 0, "title": "Title card", "start": 0.0, "end": CARD_SECONDS, "video_s": CARD_SECONDS})
    timeline.append({"shot": len(SHOTS) + 1, "title": "End card", "start": round(t - CARD_SECONDS, 2), "end": round(t, 2), "video_s": CARD_SECONDS})

    alist = work / "audio.txt"
    alist.write_text("".join(f"file '{w.as_posix()}'\n" for w in wavs), encoding="utf-8")
    audio = work / "audio.wav"
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(alist), "-c", "copy", str(audio)])
    vlist = work / "video.txt"
    vlist.write_text("".join(f"file '{s.as_posix()}'\n" for s, _, _ in segments), encoding="utf-8")

    final = out / "tour-router-demo.mp4"
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(vlist), "-i", str(audio), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", str(final)])
    (out / "tour-router-demo.srt").write_text("\n".join(srt), encoding="utf-8")
    (out / "shots.json").write_text(json.dumps(timeline, indent=1), encoding="utf-8")

    # thumbnail: the ranked-markets still (or the approval card) behind the title
    bg = next((p for p in (out / "stills" / "03-markets-taste-lift.png", out / "stills" / "02-approval-card.png") if p.exists()), None)
    if bg:
        render_html_png(thumbnail_html(bg), out / "tour-router-demo-thumb.png", 1280, 720)
    return final


# ----------------------------------------------------------------------------------------------------------
# 4. Verification
# ----------------------------------------------------------------------------------------------------------


def verify(final: Path, work: Path) -> dict:
    probe = json.loads(run([FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(final)]).stdout)
    dur = float(probe["format"]["duration"])
    size = int(probe["format"]["size"])
    kinds = {s["codec_type"]: s for s in probe["streams"]}
    assert "audio" in kinds, "no audio stream"
    assert "video" in kinds, "no video stream"
    assert dur <= HARD_CAP, f"too long: {dur:.1f}s > {HARD_CAP}s"
    assert size <= 100 * 1024 * 1024, f"too big: {size / 1e6:.1f} MB"
    assert kinds["video"]["width"] == OUT_W and kinds["video"]["height"] == OUT_H, f"unexpected size {kinds['video']['width']}x{kinds['video']['height']}"
    # sample frames and make sure none is (near) black
    samples = work / "samples"
    samples.mkdir(exist_ok=True)
    report = []
    for t in [1.5, 5, 25, 50, 80, 110, 140, dur - 8, dur - 1.5]:
        if t < 0 or t > dur:
            continue
        png = samples / f"t{int(t):03d}.png"
        run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(final), "-frames:v", "1", str(png)])
        stats = run([FFMPEG, "-hide_banner", "-ss", f"{t:.2f}", "-i", str(final), "-frames:v", "1", "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-"]).stderr
        yavg = next((float(line.split("=")[-1]) for line in stats.splitlines() if "YAVG" in line), 0.0)
        report.append({"t": round(t, 1), "png": str(png), "yavg": yavg})
        assert yavg > 16, f"frame at {t:.1f}s is black (YAVG={yavg})"
    # no stretch of (near) black longer than the card fades
    bd = run([FFMPEG, "-hide_banner", "-i", str(final), "-vf", "blackdetect=d=0.8:pix_th=0.10", "-an", "-f", "null", "-"]).stderr
    black = [line.split("]", 1)[-1].strip() for line in bd.splitlines() if "black_start" in line]
    assert not black, f"long black stretch(es): {black}"
    # audio actually has signal
    vol = run([FFMPEG, "-hide_banner", "-i", str(final), "-af", "volumedetect", "-vn", "-f", "null", "-"]).stderr
    mean_vol = next((line.split("mean_volume:")[1].strip() for line in vol.splitlines() if "mean_volume" in line), "?")
    result = {"black_stretches": black, "duration_s": round(dur, 2), "size_mb": round(size / 1048576, 1), "video": f"{kinds['video']['codec_name']} {kinds['video']['width']}x{kinds['video']['height']} {kinds['video'].get('r_frame_rate')}", "audio": f"{kinds['audio']['codec_name']} {kinds['audio'].get('sample_rate')} Hz", "mean_volume": mean_vol, "frames": report}
    print(json.dumps(result, indent=1))
    return result


# ----------------------------------------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--voice", default="en-US-AndrewNeural")
    ap.add_argument("--rate", default="-5%")
    ap.add_argument("--out", default=str(REPO / "video"))
    ap.add_argument("--work", default=str(Path(tempfile.gettempdir()) / "tour-router-video"), help="scratch dir for frames/segments (hundreds of MB)")
    ap.add_argument("--step", choices=["all", "narrate", "record", "assemble", "verify"], default="all")
    ap.add_argument("--headed", action="store_true", help="show the browser while recording")
    a = ap.parse_args()
    work, out = Path(a.work), Path(a.out)
    work.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    print(f"shots:  {len(SHOTS)}\nffmpeg: {FFMPEG}\nwork:   {work}\nout:    {out}")

    t0 = time.time()
    narration: list[float] = []
    if a.step in ("all", "narrate", "record", "assemble"):
        print("[1/4] narration")
        narration = narrate(work, a.voice, a.rate)
    if a.step in ("all", "record"):
        print(f"[2/4] recording {a.url}")
        record(work, out, a.url, narration, a.headed)
    final = out / "tour-router-demo.mp4"
    if a.step in ("all", "assemble"):
        print("[3/4] assembling")
        final = assemble(work, out, narration)
    if a.step in ("all", "assemble", "verify"):
        print("[4/4] verifying")
        verify(final, work)
    print(f"done in {time.time() - t0:.0f}s -> {final}")


if __name__ == "__main__":
    main()
