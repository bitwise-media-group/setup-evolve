# Agent instructions

Repo-specific conventions for AI agents working in `setup-evolve`. These layer on top of any machine-global agent
instructions.

## Always run `make pr` when committing

Before creating any commit, run `make pr` (or `mise run pr`) and ensure it passes. Do not commit if it fails — fix the
reported issues and re-run until clean.

The lint/build/test/pr contract comes from the shared toolchain's node archetype (`bitwise-media-group/toolchain`),
consumed as the `.mise/` submodule and selected in the root `mise.toml`; the repo `Makefile` is a thin forwarder
(`make <task>` == `mise run <task>`). `make pr` is the full pre-commit gate:

```sh
make fmt     # biome check --write + prettier (markdown) + license headers — auto-formats the tree
make lint    # biome check + markdownlint + tsc --noEmit + license, shell and workflow (actionlint, zizmor) checks
make build   # rollup bundle into dist/
make test    # vitest with coverage (coverage/cobertura-coverage.xml + coverage/junit.xml)
make pr      # fmt → lint → build → test, then runs ./commit.sh if present
make ci      # the gates CI runs: lint → build → test (no auto-format)
```

Under the hood each task runs the repo's npm scripts (`check` / `typecheck` / `build` / `test:coverage`), so the
toolchain is unchanged — the reusable CI workflow (`bitwise-media-group/github-workflows`) runs the same `mise run`
tasks. Because `make fmt` may modify files, stage any resulting changes before committing so the commit reflects the
formatted, built state. An agent must run `make fmt lint build test` instead of `make pr`, because `pr` ends by running
`./commit.sh`.

The rebuilt `dist/` matters: this Action ships its bundled output, and CI enforces that the committed `dist/` reproduces
from `src/` (`make build`). Running `make pr` keeps `dist/` in lockstep with `src/` so that gate stays green.

node is pinned in the root `mise.toml` (locked in `mise.lock`). `.node-version` feeds `actions/setup-node` in the CI
integration job, so keep it on the same version.

`.mise/` is a git submodule. After a fresh clone, run `git submodule update --init` (or clone with
`--recurse-submodules`), then `mise install`, so the `Makefile`'s `include .mise/archetypes/node/include.mk` resolves.
