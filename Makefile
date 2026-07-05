# Copyright 2026 BitWise Media Group Ltd
# SPDX-License-Identifier: MIT

# setup-evolve — a Node/TypeScript GitHub Action. The canonical
# lint/build/test/e2e/ci/pr contract comes from the shared Makefile library's
# node-action archetype (bitwise-media-group/make), consumed as the make/
# submodule and included below. setup-evolve's biome + rollup + vitest toolchain
# is exactly what the archetype drives, so there are no repo-local targets — the
# integration and e2e suites that exercise the published action run in CI, not
# through `make`.
include make/node-action.mk
