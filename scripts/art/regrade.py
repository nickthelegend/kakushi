"""Re-grade the generated art into Kakushi's Swyft palette.

Warm accents (the old vermilion) become royal blue, existing blues are kept,
and neutral greys take a navy tint, so the stills sit on the #04060f ground.
Usage: python3 -I regrade.py IN OUT   (any Pillow-readable image; frames too)
"""
import sys

import numpy as np
from PIL import Image

BLUE_HUE = 229 / 360  # royal blue #2f47f5
NAVY = np.array([4, 6, 15], dtype=np.float32) / 255


def regrade(rgb: np.ndarray) -> np.ndarray:
    img = Image.fromarray(rgb).convert("HSV")
    hsv = np.asarray(img).astype(np.float32) / 255
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    # warm band: red through amber (about 330..60 degrees), weighted by saturation
    deg = h * 360
    warm = np.clip(1 - np.minimum(np.abs(((deg + 30) % 360) - 30 - 15) / 45, 1), 0, 1)
    warm = np.where((deg > 300) | (deg < 75), np.maximum(warm, 0.0), 0) * np.clip(s * 3.2, 0, 1)
    h = np.where(warm > 0.02, BLUE_HUE, h)
    s = np.where(warm > 0.02, np.clip(s * 1.12, 0, 1), s)
    out = np.asarray(Image.fromarray((np.stack([h, s, v], -1) * 255).astype(np.uint8), "HSV").convert("RGB")).astype(np.float32) / 255
    # navy tint on the neutrals, strongest in the shadows
    neutral = (1 - np.clip(s * 3, 0, 1))[..., None]
    lum = out.mean(-1, keepdims=True)
    tint = np.array([0.82, 0.9, 1.18], dtype=np.float32)
    toned = np.clip(out * tint, 0, 1)
    shadow = np.clip(1 - lum * 2.4, 0, 1)
    toned = toned * (1 - shadow * 0.35) + NAVY * shadow * 0.35 + np.array([0.0, 0.01, 0.04]) * shadow
    out = out * (1 - neutral) + toned * neutral
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert("RGB")
    Image.fromarray(regrade(np.asarray(im))).save(dst, quality=90)
