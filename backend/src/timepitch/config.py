"""Paths are anchored to the checkout, independent of the launching directory."""
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[3]
DATASET = Path(os.environ.get('TIMEPITCH_DATASET', ROOT / 'research/data-audit/2026-10-16/derived/coverage.sqlite'))
ADVANCED_DATASET = Path(os.environ.get('TIMEPITCH_ADVANCED_DATASET',ROOT/'data/advanced/advanced-1.json'))
WEB_DIST = Path(os.environ.get('TIMEPITCH_WEB_DIST', ROOT / 'web/dist'))
ART = ROOT / 'assets/art/timepitch-premier.png'
# Recorded replays served under /replays (TP201); outside git, see docs/cases TP193.
REPLAYS_DIR = Path(os.environ.get('TIMEPITCH_REPLAYS_DIR', ROOT / '.local/replays-dist'))
# TP243: motor TouchLines (bundle nativo, AGPL) que lanza «Jugar partido».
TOUCHLINES_DIR = Path(os.environ.get('TIMEPITCH_TOUCHLINES_DIR', ROOT / 'engines/touchlines'))
GRF_PYTHON = Path(os.environ.get('TIMEPITCH_GRF_PYTHON', ROOT / ('.local/grf-spike/python/python.exe' if os.name=='nt' else '.local/grf-linux/env/bin/python3.10')))
GRF_NATIVE_DIR = Path(os.environ.get('TIMEPITCH_GRF_NATIVE_DIR', ROOT / ('.local/grf-stats-native/Release' if os.name=='nt' else '.local/grf-linux/native')))
GRF_PHYSICAL_NATIVE_DIR = Path(os.environ.get('TIMEPITCH_GRF_PHYSICAL_NATIVE_DIR',ROOT/'.local/grf-physical-periods-native/Release'))
GRF_ACTION_NATIVE_DIR = Path(os.environ.get('TIMEPITCH_GRF_ACTION_NATIVE_DIR',ROOT/'.local/grf-actions-pressure-native/Release'))

# Historical snapshots are opt-in and separate from all match/runtime databases.
HISTORICAL_DATASET = os.environ.get('TIMEPITCH_HISTORICAL_DATASET', '')
RECONSTRUCTION_DATASET = os.environ.get('TIMEPITCH_RECONSTRUCTION_DATASET', '')
