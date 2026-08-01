"""
Generate expected JSON outputs for Oracle fixtures A-L.

Writes one file per fixture to tools/weight-trend-oracle/expected/fixture_X.json.
Each file contains:
  {
    "input": { "raw_entries": [...], "now_iso": "...", "timezone": "..." },
    "expected": { ... oracle output ... }
  }

Run from the repo root or from this directory:
  python tools/weight-trend-oracle/generate_fixture_jsons.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from oracle import calculate, RawEntry   # noqa: E402
import fixtures as F                     # noqa: E402

FIXTURE_MAP = {
    "A": F.FIXTURE_A,
    "B": F.FIXTURE_B,
    "C": F.FIXTURE_C,
    "D": F.FIXTURE_D,
    "E": F.FIXTURE_E,
    "F": F.FIXTURE_F,
    "G": F.FIXTURE_G,
    "H": F.FIXTURE_H,
    "I": F.FIXTURE_I,
    "J": F.FIXTURE_J,
    "K": F.FIXTURE_K,
    "L": F.FIXTURE_L,
}

EXPECTED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "expected")
os.makedirs(EXPECTED_DIR, exist_ok=True)

for key, fx in FIXTURE_MAP.items():
    entries  = [RawEntry(**e) for e in fx["raw_entries"]]
    timezone = fx.get("timezone", "Africa/Johannesburg")
    result   = calculate(entries, fx["now_iso"], timezone)

    output = {
        "input": {
            "raw_entries": fx["raw_entries"],
            "now_iso":     fx["now_iso"],
            "timezone":    timezone,
        },
        "expected": result,
    }

    out_path = os.path.join(EXPECTED_DIR, f"fixture_{key}.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2)

    print(f"  fixture_{key}.json  status={result['status']}  confidence={result['confidence']}")

print(f"\nWrote {len(FIXTURE_MAP)} files to {EXPECTED_DIR}")
