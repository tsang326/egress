#!/bin/bash
# Regenerate validation/reference/ by running a local CFAST 7.7.7 binary on every case.
# Usage: CFAST=/path/to/cfast7_osx tools/cfast/run-references.sh
# Build CFAST from https://github.com/firemodels/cfast (tag CFAST-7.7.7): Build/CFAST/gnu_osx/make_cfast.sh
set -euo pipefail
: "${CFAST:?set CFAST to the cfast binary}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d)"
find "$root/validation/cases" -name '*.in' | sort | while read -r f; do
  rel="${f#"$root/validation/cases/"}"; name="$(basename "$f" .in)"; out="$root/validation/reference/$(dirname "$rel")"
  mkdir -p "$out"; cp "$f" "$work/"
  (cd "$work" && "$CFAST" "$name.in" -V > /dev/null 2>&1) || echo "FAILED: $rel"
  cp "$work/${name}_compartments.csv" "$work/${name}_vents.csv" "$out/" 2>/dev/null || true
  rm -f "$work/$name"*
done
rmdir "$work" 2>/dev/null || true
