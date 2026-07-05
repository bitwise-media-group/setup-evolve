# Agent instructions

Repo-specific conventions for AI agents working in `setup-evolve`. These layer on top of any machine-global agent
instructions.

## Always run `make pr` when committing

Before creating any commit, run `make pr` and ensure it passes. Do not commit if it fails — fix the reported issues and
re-run until clean.

The lint/build/test/pr contract comes from the shared Makefile library's node-action archetype
(`bitwise-media-group/make`), consumed as the `make/` submodule and included from the repo `Makefile`. `make pr` is the
full pre-commit gate:

```sh
make fmt     # biome check --write + prettier (markdown) — auto-formats the tree
make lint    # biome check + markdownlint + tsc --noEmit
make build   # rollup bundle into dist/
make test    # vitest with coverage (coverage/cobertura-coverage.xml + coverage/junit.xml)
make pr      # fmt → lint → build → test, then runs ./commit.sh if present
make ci      # the gates CI runs: lint → build → test (no auto-format)
```

Under the hood each target runs the repo's npm scripts (`check` / `typecheck` / `build` / `test:coverage`), so the
toolchain is unchanged — `make` is the language-agnostic entry point the reusable CI workflow
(`bitwise-media-group/github-workflows`) invokes. Because `make fmt` may modify files, stage any resulting changes
before committing so the commit reflects the formatted, built state.

The rebuilt `dist/` matters: this Action ships its bundled output, and CI enforces that the committed `dist/` reproduces
from `src/` (`make build`). Running `make pr` keeps `dist/` in lockstep with `src/` so that gate stays green.

`make/` is a git submodule. After a fresh clone, run `git submodule update --init` (or clone with
`--recurse-submodules`) so the `Makefile`'s `include make/node-action.mk` resolves.
