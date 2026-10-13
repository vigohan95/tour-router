#!/usr/bin/env python3
"""
Capture the Devpost gallery stills (1280x720 PNG) from the running app in LIVE mode (the fixture badge must not
be on screen). Same tooling as work/hackathons/paypal-chaser/scripts/make_video.py: Playwright headless Chromium.

  python scripts/screenshots.py --url http://localhost:3100            # dev server with QLOO_API_KEY in .env.local
  python scripts/screenshots.py --url http://localhost:3100 --share "/t/<payload>"

Outputs: docs/screenshots/*.png (names + percentages only; no credentials, no raw Qloo responses).
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "docs" / "screenshots"
BRIEF = "Plan an 8-city North American tour for Khruangbin starting in Austin in March 2027"


async def shot(page, name: str, clip_sel: str | None = None, pad: int = 8):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    if clip_sel:
        el = page.locator(clip_sel).first
        await el.scroll_into_view_if_needed()
        await page.wait_for_timeout(400)
        box = await el.bounding_box()
        if box:
            # keep the 1280x720 frame, anchored on the element
            vp = page.viewport_size
            y = max(0, min(box["y"] - pad, vp["height"] - 10))
            await page.evaluate("(y) => window.scrollBy(0, y)", y)
            await page.wait_for_timeout(300)
    await page.screenshot(path=str(path), full_page=False)
    print("wrote", path.relative_to(REPO))


async def main(url: str, share: str | None, headed: bool, only_share: bool = False):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not headed)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, device_scale_factor=1, color_scheme="light")
        page = await ctx.new_page()
        if only_share and share:
            await page.goto(url.rstrip("/") + share, wait_until="networkidle")
            await page.wait_for_selector("[data-page='shared-tour']")
            await page.wait_for_timeout(1500)
            await shot(page, "09-shared-tour-page")
            await page.evaluate("window.scrollBy(0, 640)")
            await page.wait_for_timeout(400)
            await shot(page, "10-shared-tour-page-itinerary")
            await browser.close()
            return
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_selector("text=Tour Router")
        badge = await page.locator("text=data: Qloo live").count()
        if badge == 0:
            sys.exit("The app is not in live mode (badge missing); set QLOO_API_KEY and restart the dev server.")
        await page.wait_for_timeout(500)
        # 0. first screen: real acts as suggestions, live badge
        await shot(page, "00-studio-live")
        # 1. brief -> approval card (8 cities > policy max 6)
        await page.fill("input[placeholder*='Plan a 10-city']", BRIEF)
        await page.keyboard.press("Enter")
        await page.wait_for_selector("text=Approval needed", timeout=180_000)
        await page.wait_for_timeout(800)
        await shot(page, "04-approval-card")
        await page.click("button:has-text('Approve')")
        await page.wait_for_selector("text=Route for Khruangbin", timeout=180_000)
        await page.wait_for_timeout(1200)
        # 2. ranked markets grid with taste lift
        await shot(page, "01-markets-grid-taste-lift", "text=2. Markets")
        # 3. partner cards
        await shot(page, "02-partner-cards-explainability", "text=3. Partners per city")
        # 4. map + itinerary
        await shot(page, "03-map-itinerary", "text=4. Map")
        # 5. counterfactual
        await page.wait_for_selector("text=6. What did taste change?")
        await shot(page, "05-counterfactual-population", "text=6. What did taste change?")
        # 6. why?
        await page.fill("input[placeholder*='Plan a 10-city']", "Why Denver?")
        await page.keyboard.press("Enter")
        await page.wait_for_selector("text=by taste", timeout=120_000)
        await page.wait_for_timeout(600)
        await page.evaluate("window.scrollTo(0, 0)")
        await shot(page, "06-why-denver")
        # 7. audit log + Qloo calls panel
        await page.click("button:has-text('Audit (')")
        await page.wait_for_timeout(400)
        await shot(page, "07-audit-log", "[data-panel='audit']")
        await page.click("text=Qloo calls behind this plan")
        await page.wait_for_timeout(400)
        await shot(page, "08-qloo-calls", "[data-panel='qloo-calls']")
        # 8. shared page
        if share:
            await page.goto(url.rstrip("/") + share, wait_until="networkidle")
            await page.wait_for_selector("[data-page='shared-tour']")
            await page.wait_for_timeout(1500)
            await shot(page, "09-shared-tour-page")
        await browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3100")
    ap.add_argument("--share", default=None, help="share path (/t/...) to capture as well")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--only-share", action="store_true", help="only capture the share page")
    a = ap.parse_args()
    asyncio.run(main(a.url, a.share, a.headed, a.only_share))
