/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import * as semver from 'semver'
import { MIN_SUPPORTED_VERSION } from './constants'
import { getReleaseByTag, listReleases, type Octokit, type Release } from './github'

export interface ResolvedVersion {
  version: string
  release: Release
}

export type VersionSpec = { kind: 'exact'; version: string } | { kind: 'range'; range: string }

// Classifies the version input: "latest", an exact version (with or without a
// leading "v"), or an npm-semver range. Commas in ranges are treated as AND
// separators (">=0.1, <1" works); all other semantics are npm semver's, so
// "~>" behaves as "~" (e.g. "~>3.1" means ">=3.1.0 <3.2.0").
export function parseVersionSpec(input: string): VersionSpec {
  const trimmed = input.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'latest') {
    return { kind: 'range', range: '*' }
  }

  const exact = semver.valid(trimmed.replace(/^v/, ''))
  if (exact) {
    return { kind: 'exact', version: exact }
  }

  const range = semver.validRange(trimmed.replace(/,/g, ' '))
  if (!range) {
    throw new Error(
      `invalid version input "${input}": expected an exact version, "latest", or an npm-semver range (e.g. "~>0.1", ">=0.1, <1")`,
    )
  }
  return { kind: 'range', range }
}

function assertMinVersion(version: string): void {
  if (semver.lt(version, MIN_SUPPORTED_VERSION)) {
    throw new Error(
      `evolve ${version} is not supported: versions before v${MIN_SUPPORTED_VERSION} were signed ` +
        `with a different release pipeline identity. Use v${MIN_SUPPORTED_VERSION} or later.`,
    )
  }
}

export async function resolveVersion(
  octokit: Octokit,
  input: string,
  preRelease: boolean,
): Promise<ResolvedVersion> {
  const spec = parseVersionSpec(input)

  if (spec.kind === 'exact') {
    const release = await getReleaseByTag(octokit, `v${spec.version}`)
    assertMinVersion(spec.version)
    return { version: spec.version, release }
  }

  const releases = await listReleases(octokit)
  const candidates = new Map<string, Release>()
  for (const release of releases) {
    const version = semver.valid(release.tag.replace(/^v/, ''))
    if (!version) continue
    if (!preRelease && (release.prerelease || semver.prerelease(version))) continue
    candidates.set(version, release)
  }

  // Candidates are pre-filtered for prerelease eligibility above, so always
  // include prereleases here: with pre-release: true they compete with stable
  // under normal semver ordering and may match plain ranges like "*".
  const best = semver.maxSatisfying([...candidates.keys()], spec.range, {
    includePrerelease: true,
  })
  if (!best) {
    const nearest = semver
      .rsort([...candidates.keys()])
      .slice(0, 5)
      .join(', ')
    throw new Error(
      `no evolve release satisfies "${input}" (pre-release: ${preRelease}); nearest candidates: ${nearest || 'none'}`,
    )
  }

  const release = candidates.get(best)
  if (!release) throw new Error(`internal error: no release recorded for version ${best}`)
  assertMinVersion(best)
  return { version: best, release }
}
