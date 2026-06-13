# setup-evolve

GitHub Action that installs the [evolve](https://github.com/bitwise-media-group/evolve) CLI from GitHub Releases, with
caching and fail-closed supply-chain verification.

```yaml
steps:
  - uses: bitwise-media-group/setup-evolve@v1
  - run: evolve run
```

Every installation — including cache hits — is cryptographically verified before the binary lands on `PATH`. There is no
input to skip verification.

## Inputs

| Input          | Default               | Description                                                                                                                           |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `version`      | `latest`              | Exact version (`0.1.0`, `v0.1.0`), `latest`, or an npm-semver range (`~>0.1`, `>=0.1, <1`, `^0.1`).                                   |
| `pre-release`  | `false`               | When `true`, prereleases are eligible alongside stable releases for `latest` and ranges. An exact prerelease version always installs. |
| `github-token` | `${{ github.token }}` | Token for release listing, asset download, and attestation lookup.                                                                    |
| `cache`        | `true`                | Persist the verified installation across runs via the GitHub Actions cache. The runner tool cache is always used.                     |

### Version ranges

Ranges use [npm semver](https://github.com/npm/node-semver#ranges) semantics. Commas are treated as AND separators, so
HashiCorp-style `>=0.1, <1` works as expected. `~>` is accepted as an alias of npm's `~`; note this differs from
HashiCorp's pessimistic operator for two-segment versions (`~>3.1` here means `>=3.1.0 <3.2.0`, not `<4.0.0`).

With `pre-release: true`, prereleases compete with stable versions under normal semver ordering — `latest` may still
resolve to a stable release if it is the newest. Remember that in semver, `0.3.0-rc.1` sorts _below_ `0.3.0`, so the
range `>=0.3` is not satisfied by `0.3.0-rc.1`.

## Outputs

| Output      | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| `version`   | Resolved version that was installed (no `v` prefix).         |
| `path`      | Directory containing the binary (already on `PATH`).         |
| `cache-hit` | `tool-cache`, `cache`, or `false` (fresh verified download). |

## Examples

```yaml
# Exact version
- uses: bitwise-media-group/setup-evolve@v1
  with:
    version: 0.1.0

# Range, prereleases eligible
- uses: bitwise-media-group/setup-evolve@v1
  with:
    version: ">=0.1, <1"
    pre-release: true
```

## Security model

A fresh download passes five independent checks, all fail-closed:

1. **GitHub API asset digest** — the downloaded bytes must match the `sha256` digest GitHub recorded at asset-upload
   time.
2. **`checksums.txt`** — the archive must match GoReleaser's checksum manifest.
3. **SLSA build provenance** — a
   [GitHub attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations) for
   the archive digest must verify against the Sigstore public-good trust root, be signed by evolve's release workflow
   (`release.yaml` on `main`, pinned in code as an anchored regex), include a Rekor transparency-log entry, and name the
   archive + digest as a subject with the build coming from `bitwise-media-group/evolve`.
4. **Cosign binary signature** — the _extracted binary_ must verify against its keyless sigstore bundle under the same
   pinned identity, Rekor inclusion required.
5. **Identity pinning** — signer identity and OIDC issuer are constants in [`src/constants.ts`](src/constants.ts), not
   inputs; they cannot be loosened from a workflow.

Verification runs in-process via [sigstore-js](https://github.com/sigstore/sigstore-js) — no cosign or gh CLI required,
so it works identically on self-hosted runners. Self-hosted runners need a runner release with the `node24` runtime
(2.327.0+; 2.335.0+ recommended, which bundles node ≥ 24.15 matching sigstore v5's support floor).

**Cached installations are re-verified.** A restored Actions-cache or tool-cache entry must re-pass cosign verification
of the binary against the bundle stored at install time. The trust anchors (Sigstore TUF roots, pinned identity) live
outside the cache, so a poisoned cache entry cannot verify; it is discarded with a warning and the action falls back to
a fresh, fully verified download.

### Network egress

Beyond `github.com`/`api.github.com`/`objects.githubusercontent.com`, verification fetches Sigstore trust material from
**`tuf-repo-cdn.sigstore.dev`**. If you filter runner egress (e.g. with harden-runner), allow that host.

### Verify independently

You can reproduce the action's checks out-of-band:

```sh
gh attestation verify evolve_0.1.0_linux_amd64.tar.gz --owner bitwise-media-group
cosign verify-blob \
  --certificate-identity https://github.com/bitwise-media-group/evolve/.github/workflows/release.yaml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --bundle evolve_linux_amd64.sigstore.json \
  ./evolve
```

### Consuming this action

Pin by commit SHA for maximum assurance:

```yaml
- uses: bitwise-media-group/setup-evolve@<sha> # vX.Y.Z
```

CI enforces that the committed `dist/` bundle reproduces exactly from `src/`.

## Roadmap

- `verify-release-attestation` input: also verify GitHub's automatic release attestation (in-toto `release/v0.2`, signed
  by GitHub's internal Sigstore instance), which binds the release assets and `checksums.txt` to the tag commit.
- `sbom-path` output exposing the verified SPDX SBOM published with each release.
- Air-gap support: pre-seeded Sigstore TUF cache for egress-locked self-hosted runners.
- `minimum-version` input as a rollback-attack floor for `latest`/range installs.

## Development

```sh
npm ci
npm run all          # lint + typecheck + unit tests + build
RUN_INTEGRATION=1 npx vitest run __tests__/integration  # real crypto, network required
```

Releases are automated with release-please from Conventional Commits; the `v1` major tag follows the latest release.
