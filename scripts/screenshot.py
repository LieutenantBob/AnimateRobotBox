"""Capture screenshots of the 3D viewer at different animation states."""

import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright


def capture_screenshots(base_url: str, output_dir: str):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})

        print(f"Opening {base_url}...")
        page.goto(base_url, wait_until="networkidle")

        # Wait for the loading screen to disappear
        print("Waiting for model to load...")
        try:
            page.wait_for_selector("#loading.hidden", timeout=30000)
        except Exception:
            print("Loading didn't complete in 30s, capturing anyway")

        # Give Three.js a moment to render
        time.sleep(2)

        # Screenshot 1: Initial state (t=0)
        print("Capturing: initial state...")
        page.screenshot(path=str(output / "01_initial.png"))

        # Use the scrubber to set different animation positions
        scrubber = page.locator("#scrubber")

        positions = [
            (0, "01_initial"),
            (139, "02_lid_opening"),     # ~2.5s - lid mid-open
            (250, "03_panels_folding"),   # ~4.5s - panels mid-fold
            (389, "04_panels_flat"),      # ~7s - panels flat
            (556, "05_shelf_flip"),       # ~10s - shelf flipping
            (722, "06_equipment_setup"),  # ~13s - equipment moving
            (889, "07_arm_extending"),    # ~16s - arm extending
            (1000, "08_fully_unfolded"),  # 18s - done
        ]

        for value, name in positions:
            scrubber.evaluate(f"el => el.value = {value}")
            scrubber.dispatch_event("input")
            time.sleep(0.5)  # Let Three.js render
            path = output / f"{name}.png"
            page.screenshot(path=str(path))
            print(f"  Captured: {name} (scrubber={value})")

        browser.close()
        print(f"\nAll screenshots saved to {output_dir}")


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/src/viewer/"
    out = sys.argv[2] if len(sys.argv) > 2 else "assets/screenshots"
    capture_screenshots(url, out)
