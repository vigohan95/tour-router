#!/usr/bin/env python3
"""
Capture the four differentiation stills (1280x720 PNG) from the running app in LIVE mode:
  11-policy-holds.png            policy panel with a held venue, blackout dates and the radius clause, then the HELD stop
  12-tour-opener-cobill.png      tour opener + co-bill markets panel
  13-policy-counterfactual.png   "Compare under policy B" with the decisions that flip
  14-why-not.png                 "Why not <city>?" answer in the agent drawer
Same tooling as scripts/screenshots.py (Playwright headless Chromium). Refuses to run against fixtures.

  python scripts/screenshots-v2.py --url http://localhost:3200
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "docs" / "screenshots"
BRIEF = "Plan a 6-city North American tour for Khruangbin starting in Austin in March 2027"


async def shot(page, name: str, clip_sel: str | None = None, pad: int = 8):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.png"
    if clip_sel:
        el = page.locator(clip_sel).first
        await el.scroll_into_view_if_needed()
        await page.wait_for_timeout(400)
        box = await el.bounding_box()
        if box:
            vp = page.viewport_size
            y = max(0, min(box["y"] - pad, vp["height"] - 10))
            await page.evaluate("(y) => window.scrollBy(0, y)", y)
            await page.wait_for_timeout(300)
    await page.screenshot(path=str(path), full_page=False)
    print("wrote", path.relative_to(REPO))


async def send(page, text: str, wait_for: str, timeout: int = 180_000):
    await page.fill("input[placeholder*='Plan a 10-city']", text)
    await page.keyboard.press("Enter")
    await page.wait_for_selector(wait_for, timeout=timeout)
    await page.wait_for_timeout(900)


async def main(url: str, headed: bool):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not headed)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 720}, device_scale_factor=1, color_scheme="light")
        page = await ctx.new_page()
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_selector("text=Tour Router")
        if await page.locator("text=data: Qloo live").count() == 0:
            sys.exit("The app is not in live mode (badge missing); set QLOO_API_KEY and restart the server.")
        # Fresh session.
        await page.click("button:has-text('Reset')")
        await page.wait_for_timeout(600)
        # 1. Policy: a held venue, two blackout dates, a 200 km radius clause.
        await page.click("button:has-text('Policy')")
        await page.wait_for_selector("[data-panel='policy']")
        await page.fill("[data-field='minKmBetweenStops']", "200")
        await page.fill("[data-field='blackoutDates']", "2027-03-03, 2027-03-04")
        await page.fill("[data-field='heldVenues']", "Denver; Mission Ballroom; 2027-03-09")
        await page.wait_for_timeout(300)
        await shot(page, "11-policy-holds")
        await page.click("button:has-text('Save policy')")
        await page.wait_for_timeout(600)
        # 2. Plan (6 stops = inside the cap, so no approval card), then the HELD stop in the itinerary.
        await send(page, BRIEF, "text=Route for Khruangbin")
        await page.wait_for_selector("text=5. Itinerary")
        await page.wait_for_selector("text=HELD", timeout=30_000)
        # 3. Tour opener + co-bill markets.
        await page.wait_for_selector("[data-panel='cobill']")
        await page.click("[data-panel='cobill'] button:has-text('Find tour opener')")
        await page.wait_for_selector("text=Runners-up", timeout=120_000)
        await page.wait_for_timeout(800)
        await shot(page, "12-tour-opener-cobill", "[data-panel='cobill']")
        # 4. Policy B: radius clause 200 -> 500 km.
        await page.wait_for_selector("[data-panel='policy-b']")
        await page.select_option("[data-panel='policy-b'] select", "minKmBetweenStops")
        await page.fill("[data-panel='policy-b'] input", "500")
        await page.click("[data-panel='policy-b'] button:has-text('Compare under policy B')")
        await page.wait_for_selector("[data-section='policy-diff']", timeout=60_000)
        await page.wait_for_timeout(600)
        await shot(page, "13-policy-counterfactual", "[data-panel='compare']")
        # 5. Why not <a routed-adjacent city>?
        await send(page, "Why not Chicago?", "text=Why not routed:", timeout=120_000)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(400)
        await shot(page, "14-why-not")
        await browser.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3200")
    ap.add_argument("--headed", action="store_true")
    a = ap.parse_args()
    asyncio.run(main(a.url, a.headed))
