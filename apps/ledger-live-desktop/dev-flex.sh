#!/usr/bin/env bash
# FLEX desktop dev launcher — works around the rspack v2 Rust memory allocation
# crash ("memory allocation of 171882204 bytes failed") on this 16GB machine.
#
# Root cause: rspack.renderer.ts sets devtool "eval-source-map" in dev, which
# makes the Rust allocator reserve huge contiguous regions. RSPACK_NO_SOURCEMAP
# (handled in tools/rspack/rspack.renderer.ts) disables it.
#
# Usage: bash apps/ledger-live-desktop/dev-flex.sh
set -e
cd "$(dirname "$0")"

export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=12288"
export RSPACK_NO_SOURCEMAP=true
export FLEX_DEMO="${FLEX_DEMO:-true}"

exec pnpm start
