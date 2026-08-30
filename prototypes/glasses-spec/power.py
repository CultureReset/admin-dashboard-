#!/usr/bin/env python3
"""Glasses power budget. Source of the figures in SPEC.html §11."""

EFF = 0.87            # LDO/buck conversion efficiency
WAKING_HOURS = 16
QUERIES = 30
WH_PER_MAH = 3.7 / 1000
G_PER_MAH = 0.020     # cell + protection circuitry

# Per-query energy, in watt-seconds: capture, uplink, then playback.
QUERY_WS = 0.3 * 0.5 + 0.8 * 0.5 + 0.4 * 4

CONFIGS = [
    # name,                          continuous W, display W
    ("A  Pi Zero 2 W, always on",     0.70 + 0.35, 0.000),  # cannot sleep: no suspend-to-RAM
    ("B  ESP32-S3 only",              0.050,       0.000),
    ("C  ESP32-S3 + green microLED",  0.050,       0.004),  # 40 mW, on 10% of the time
    ("D  ESP32-S3 + birdbath OLED",   0.050,       0.100),  # 1 W, on 10% of the time
]

print(f"{WAKING_HOURS} waking hours, {QUERIES} queries/day, {EFF:.0%} conversion\n" + "-" * 72)
print(f"{'configuration':32s}{'daily':>10s}{'cell':>12s}{'weight':>12s}")
for name, cont_w, disp_w in CONFIGS:
    wh = ((cont_w + disp_w) * WAKING_HOURS + QUERY_WS * QUERIES / 3600) / EFF
    mah = wh / WH_PER_MAH
    print(f"{name:32s}{wh:8.2f} Wh{mah:9.0f} mAh{mah * G_PER_MAH:9.0f} g")

print("\nFor scale: Ray-Ban Meta is ~50 g in total, frames included.")
