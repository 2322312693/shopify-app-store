#!/usr/bin/env python3
"""Validate reusable Shopify listing metadata and image deliverables."""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:
    raise SystemExit("Pillow is required: python3 -m pip install Pillow") from exc


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def check_image(errors: list[str], path: Path, expected: tuple[int, int]) -> None:
    if not path.is_file():
        fail(errors, f"Missing image: {path}")
        return
    try:
        with Image.open(path) as image:
            if image.size != expected:
                fail(errors, f"Wrong size for {path}: {image.size}, expected {expected}")
    except OSError as exc:
        fail(errors, f"Unreadable image {path}: {exc}")


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate_listing.py <app-listing-directory>", file=sys.stderr)
        return 2

    listing = Path(sys.argv[1]).expanduser().resolve()
    metadata_path = listing / "metadata.en.json"
    errors: list[str] = []

    if not metadata_path.is_file():
        fail(errors, f"Missing metadata: {metadata_path}")
        metadata = {}
    else:
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            fail(errors, f"Invalid metadata JSON: {exc}")
            metadata = {}

    features = metadata.get("feature_list", [])
    if len(features) != 3:
        fail(errors, f"Expected exactly 3 features, found {len(features)}")
    for index, feature in enumerate(features, 1):
        if not isinstance(feature, str) or not feature.strip():
            fail(errors, f"Feature {index} is empty")
        elif len(feature) > 80:
            fail(errors, f"Feature {index} is {len(feature)} characters; maximum is 80")

    introduction = metadata.get("app_introduction", "")
    if not introduction or len(introduction) > 100:
        fail(errors, f"App introduction length is {len(introduction)}; expected 1–100")

    details = metadata.get("app_details", "")
    if not details or len(details) > 500:
        fail(errors, f"App details length is {len(details)}; expected 1–500")

    assets = metadata.get("assets", {})
    icon_value = assets.get("app_icon", "")
    feature_value = assets.get("feature_media", "")
    if icon_value:
        check_image(errors, listing / icon_value, (1200, 1200))
    else:
        fail(errors, "metadata assets.app_icon is missing")
    if feature_value:
        check_image(errors, listing / feature_value, (1600, 900))
    else:
        fail(errors, "metadata assets.feature_media is missing")

    feature_alt = assets.get("feature_media_alt", "")
    if not isinstance(feature_alt, str) or not feature_alt.strip():
        fail(errors, "Feature media alt text is missing")

    screenshots = assets.get("screenshots", [])
    if not 3 <= len(screenshots) <= 6:
        fail(errors, f"Expected 3–6 screenshots, found {len(screenshots)}")
    seen_alts: set[str] = set()
    for index, screenshot in enumerate(screenshots, 1):
        file_value = screenshot.get("file", "") if isinstance(screenshot, dict) else ""
        alt = screenshot.get("alt", "") if isinstance(screenshot, dict) else ""
        if file_value:
            check_image(errors, listing / file_value, (1600, 900))
        else:
            fail(errors, f"Screenshot {index} file is missing")
        if not isinstance(alt, str) or not alt.strip():
            fail(errors, f"Screenshot {index} alt text is missing")
        elif alt in seen_alts:
            fail(errors, f"Screenshot {index} duplicates another alt text")
        else:
            seen_alts.add(alt)

    junk = list(listing.rglob(".DS_Store"))
    if junk:
        fail(errors, "Remove .DS_Store files before packaging: " + ", ".join(map(str, junk)))

    if errors:
        print("Listing validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Listing validation passed: {listing}")
    print(f"- 3 features")
    print(f"- {len(screenshots)} screenshots at 1600x900")
    print("- app icon and feature media dimensions verified")
    print("Manual review still required for image content, PII, and feature clarity.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
