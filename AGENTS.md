# Agent instructions

Repo-specific conventions for AI agents working in `setup-evolve`. These layer on top of any machine-global agent
instructions.

## Always run `make pr` when committing

Before creating any commit, run `make pr` (or `mise run pr`) and ensure it passes. Do not commit if it fails — fix the
reported issues and re-run until clean.

The lint/build/test/pr contract comes from the shared toolchain's node archetype (`bitwise-media-group/toolchain`),
consumed as the `.mise/` submodule and selected in the root `mise.toml`; the repo `Makefile` is a thin forwarder
(`make <task>` == `mise run <task>`). The repo is on bun: the toolchain's pinned bun is the runtime, package manager,
formatter, type checker, bundler and test runner, so there is no `node` pin. `make pr` is the full pre-commit gate:

```sh
make fmt     # biome lint --write + bun fmt (code and markdown) + markdownlint --fix + license headers
make lint    # biome lint + bun check (type check) + markdownlint + bun fmt --check + license, shell and workflow checks
make build   # bun build bundle into dist/
make test    # bun test with coverage (coverage/lcov.info + coverage/junit.xml)
make pr      # fmt → lint → build → test, then runs ./commit.sh if present
make ci      # the gates CI runs: lint → build → test (no auto-format)
```

Under the hood each task runs the repo's package.json scripts (`check` / `check:fix` / `format` / `typecheck` / `build`
/ `test:coverage`) — the reusable CI workflow (`bitwise-media-group/github-workflows`) runs the same `mise run` tasks.
Because `make fmt` may modify files, stage any resulting changes before committing so the commit reflects the formatted,
built state. An agent must run `make fmt lint build test` instead of `make pr`, because `pr` ends by running
`./commit.sh`.

Keep `--no-script` on `bun check` and `bun fmt` in package.json scripts: without it, `bun check` runs the `check` script
(biome) instead of the type checker. Keep `--isolate` on `bun test`: `mock.module()` replaces a module process-wide, so
without it one test file's mocks leak into the next. The `check` scripts run biome's launcher with bun
(`bun ./node_modules/@biomejs/biome/bin/biome`) because its bin is a `#!/usr/bin/env node` script, and nothing here
installs Node.js.

The rebuilt `dist/` matters: this Action ships its bundled output, and CI enforces that the committed `dist/` reproduces
from `src/` (`make build`). The build script's `--define __dirname=import.meta.dirname` keeps it reproducible: without
it, `bun build` bakes the building checkout's absolute path into the bundle wherever a dependency reads `__dirname`.
Running `make pr` keeps `dist/` in lockstep with `src/` so that gate stays green.

bun comes from the toolchain's pin (locked in its `mise.lock`) and nowhere else: the reusable CI job and the CI
integration job both install it through mise.

`.mise/` is a git submodule. After a fresh clone, run `git submodule update --init` (or clone with
`--recurse-submodules`), then `mise install`, so the `Makefile`'s `include .mise/archetypes/node/include.mk` resolves.
