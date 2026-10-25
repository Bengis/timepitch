"""Builds `build/freeplay-native.mjs` from `build/freeplay-calibrated.mjs` (TP243).

The calibrated bundle (rolldown.calibrated.config.mjs) runs TouchLines on a physical clock: TIME_SCALE 1, 45 real
minutes per half. That multiplies the play 18-fold and gives ~73 shots per team (TP242). The native bundle restores the
upstream clock (TIME_SCALE 18, 150 real seconds per half), lets halves end (testMode off) and still writes the match
clock per sample (`match_time_ms`, `physics_ms`) so the web player reads it like any other recording. Each rewrite must
match exactly once; the calibration hooks stay and `cal-native.json` sets them to upstream behaviour.

    python engines/touchlines/make_native.py
"""
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE, TARGET = HERE / 'build/freeplay-calibrated.mjs', HERE / 'build/freeplay-native.mjs'
SOURCE_SHA256 = '702b4754ff13e140'  # prefix of the calibrated bundle built on 2026-10-22 (TP193)
REWRITES = [
    ('const TIME_SCALE = 1;', 'const TIME_SCALE = 18; /* timepitch native: upstream clock, 150 s per half */'),
    ('\ttestMode: !physicalClock', '\ttestMode: false'),
    ('\tif (physicalClock) {', '\tif (true) { /* timepitch native: match clock on every sample */'),
    ('const ENGINE_VERSION = "touchlines-5c5c71a-freeplay";', 'const ENGINE_VERSION = "touchlines-5c5c71a-native";'),
    ('\t\tphysical_clock: physicalClock,', '\t\tphysical_clock: physicalClock,\n\t\tnative_clock: true,'),
]


def main():
    text = SOURCE.read_text(encoding='utf-8')
    if not hashlib.sha256(text.encode('utf-8')).hexdigest().startswith(SOURCE_SHA256):
        raise SystemExit('unexpected calibrated bundle')
    for old, new in REWRITES:
        if text.count(old) != 1:
            raise SystemExit(f'rewrite target not found exactly once: {old!r}')
        text = text.replace(old, new)
    TARGET.write_text(text, encoding='utf-8', newline='\n')
    print(TARGET.name, hashlib.sha256(text.encode('utf-8')).hexdigest())


if __name__ == '__main__':
    main()
