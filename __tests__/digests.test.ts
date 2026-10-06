/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertApiDigest, assertChecksum, parseChecksums } from '../src/verify/digests'

const checksums = parseChecksums(
  readFileSync(join(import.meta.dirname, 'fixtures', 'checksums.txt'), 'utf8'),
)

const ARCHIVE = 'evolve_0.1.0_darwin_arm64.tar.gz'
const DIGEST = 'd8ff511609b474a2de9272523b6031b1b197863c334c272388e2a3389b4c97f6'

describe('parseChecksums', () => {
  it('parses the real GoReleaser checksums.txt', () => {
    expect(checksums.size).toBe(12)
    expect(checksums.get(ARCHIVE)).toBe(DIGEST)
  })

  it('strips the sha256sum binary-mode * prefix', () => {
    const parsed = parseChecksums(`${DIGEST}  *${ARCHIVE}\n`)
    expect(parsed.get(ARCHIVE)).toBe(DIGEST)
  })
})

describe('assertChecksum', () => {
  it('accepts a matching digest case-insensitively', () => {
    expect(() => assertChecksum(checksums, ARCHIVE, DIGEST.toUpperCase())).not.toThrow()
  })

  it('rejects a mismatched digest', () => {
    expect(() => assertChecksum(checksums, ARCHIVE, 'f'.repeat(64))).toThrow(/checksum mismatch/)
  })

  it('rejects files missing from checksums.txt', () => {
    expect(() => assertChecksum(checksums, 'evolve_9.9.9_linux_amd64.tar.gz', DIGEST)).toThrow(
      /no entry/,
    )
  })
})

describe('assertApiDigest', () => {
  it('accepts a matching sha256: digest', () => {
    expect(() => assertApiDigest(`sha256:${DIGEST}`, DIGEST, ARCHIVE)).not.toThrow()
  })

  it('rejects mismatches', () => {
    expect(() => assertApiDigest(`sha256:${'f'.repeat(64)}`, DIGEST, ARCHIVE)).toThrow(
      /API digest mismatch/,
    )
  })

  it('fails closed when the API omits the digest', () => {
    expect(() => assertApiDigest(null, DIGEST, ARCHIVE)).toThrow(/no digest/)
  })
})
