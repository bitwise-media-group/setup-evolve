/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { MIN_SUPPORTED_VERSION } from '../src/constants'
import type { Octokit } from '../src/github'
import { parseVersionSpec, resolveVersion } from '../src/version'

function release(tag: string, prerelease = false, draft = false) {
  return { tag_name: tag, prerelease, draft, assets: [] }
}

// Minimal fake satisfying the two Octokit call shapes github.ts uses.
function fakeOctokit(releases: ReturnType<typeof release>[]): Octokit {
  return {
    paginate: async () => releases,
    rest: {
      repos: {
        listReleases: {},
        getReleaseByTag: async ({ tag }: { tag: string }) => {
          const found = releases.find((r) => r.tag_name === tag && !r.draft)
          if (!found) {
            throw Object.assign(new Error('Not Found'), { status: 404 })
          }
          return { data: found }
        },
      },
    },
  } as unknown as Octokit
}

const RELEASES = [
  release('v0.1.0'),
  release('v0.2.0'),
  release('v0.2.1'),
  release('v0.3.0'),
  release('v0.4.0-rc.1', true),
  release('v1.0.0', false, true), // draft: must never be visible
  release('nightly'), // non-semver tag: ignored
]

describe('parseVersionSpec', () => {
  it('treats latest and empty input as the universal range', () => {
    expect(parseVersionSpec('latest')).toEqual({ kind: 'range', range: '*' })
    expect(parseVersionSpec('')).toEqual({ kind: 'range', range: '*' })
  })

  it('parses exact versions with and without v prefix', () => {
    expect(parseVersionSpec('0.1.0')).toEqual({ kind: 'exact', version: '0.1.0' })
    expect(parseVersionSpec('v0.1.0')).toEqual({ kind: 'exact', version: '0.1.0' })
    expect(parseVersionSpec('0.3.0-rc.1')).toEqual({ kind: 'exact', version: '0.3.0-rc.1' })
  })

  it('normalizes comma-separated clauses to npm AND ranges', () => {
    expect(parseVersionSpec('>=0.1, <1')).toEqual({ kind: 'range', range: '>=0.1.0 <1.0.0-0' })
  })

  it('accepts ~> as npm tilde', () => {
    const spec = parseVersionSpec('~>0.2')
    expect(spec.kind).toBe('range')
  })

  it('rejects garbage', () => {
    expect(() => parseVersionSpec('not-a-version')).toThrow(/invalid version input/)
  })
})

describe('resolveVersion', () => {
  const octokit = fakeOctokit(RELEASES)

  it('latest picks the max stable release', async () => {
    const { version, release: rel } = await resolveVersion(octokit, 'latest', false)
    expect(version).toBe('0.3.0')
    expect(rel.tag).toBe('v0.3.0')
  })

  it('latest with pre-release lets prereleases compete', async () => {
    const { version } = await resolveVersion(octokit, 'latest', true)
    expect(version).toBe('0.4.0-rc.1')
  })

  it('ranges exclude prereleases unless pre-release is set', async () => {
    await expect(resolveVersion(octokit, '>0.3.0', false)).rejects.toThrow(/no evolve release/)
    const { version } = await resolveVersion(octokit, '>0.3.0', true)
    expect(version).toBe('0.4.0-rc.1')
  })

  it('comma ranges work', async () => {
    const { version } = await resolveVersion(octokit, '>=0.3, <0.4', false)
    expect(version).toBe('0.3.0')
  })

  it('~> ranges work with npm tilde semantics', async () => {
    const { version } = await resolveVersion(octokit, '~>0.3.0', false)
    expect(version).toBe('0.3.0')
  })

  it('never selects drafts', async () => {
    const { version } = await resolveVersion(octokit, '>=0.1', false)
    expect(version).toBe('0.3.0')
  })

  it('exact versions resolve via the tag even as prereleases', async () => {
    const { version, release: rel } = await resolveVersion(octokit, 'v0.4.0-rc.1', false)
    expect(version).toBe('0.4.0-rc.1')
    expect(rel.tag).toBe('v0.4.0-rc.1')
  })

  it('exact versions that do not exist produce a clear error', async () => {
    await expect(resolveVersion(octokit, '9.9.9', false)).rejects.toThrow(
      /no evolve release found for tag v9.9.9/,
    )
  })

  it('no-match errors list nearest candidates', async () => {
    await expect(resolveVersion(octokit, '>=2', false)).rejects.toThrow(/nearest candidates: 0.3.0/)
  })

  it('rejects exact versions older than the minimum supported version', async () => {
    await expect(resolveVersion(octokit, '0.1.0', false)).rejects.toThrow(
      new RegExp(`not supported.*v${MIN_SUPPORTED_VERSION}`),
    )
    await expect(resolveVersion(octokit, 'v0.2.1', false)).rejects.toThrow(
      new RegExp(`not supported.*v${MIN_SUPPORTED_VERSION}`),
    )
  })

  it('rejects ranges that resolve to a version older than the minimum supported version', async () => {
    await expect(resolveVersion(octokit, '>=0.1, <0.3', false)).rejects.toThrow(
      new RegExp(`not supported.*v${MIN_SUPPORTED_VERSION}`),
    )
  })
})
