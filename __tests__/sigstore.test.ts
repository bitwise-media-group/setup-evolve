/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyMock = vi.fn()
const createVerifierMock = vi.fn(async () => ({ verify: verifyMock }))

vi.mock('sigstore', () => ({
  createVerifier: createVerifierMock,
}))

const { VERIFY_POLICY, verifyCosignBundle, verifySlsaProvenance } = await import(
  '../src/verify/sigstore'
)

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'))

// Real attestation API response for evolve_0.1.0_darwin_arm64.tar.gz: one SLSA
// provenance bundle and one GitHub release attestation (non-SLSA predicate).
const apiResponse = fixture('attestations.json')
const allBundles = apiResponse.attestations.map((a: { bundle: unknown }) => a.bundle)
const cosignBundle = fixture('evolve_darwin_arm64.sigstore.json')

const ARCHIVE = 'evolve_0.1.0_darwin_arm64.tar.gz'
const DIGEST = 'd8ff511609b474a2de9272523b6031b1b197863c334c272388e2a3389b4c97f6'

const SIGNER = {
  identity: {
    subjectAlternativeName:
      'https://github.com/bitwise-media-group/github-workflows/.github/workflows/release.yaml@e37b7f61bbd233ae77aad81c967d08ad49220b8f',
  },
}

beforeEach(() => {
  verifyMock.mockReset()
  verifyMock.mockReturnValue(SIGNER)
})

describe('verification policy', () => {
  it('pins identity, issuer, and mandatory Rekor + CT log inclusion', () => {
    // Regression guard: loosening any of these is a security change.
    expect(VERIFY_POLICY).toEqual({
      certificateIdentityURI:
        '^https://github\\.com/bitwise-media-group/github-workflows/\\.github/workflows/release\\.yaml@.+$',
      certificateIssuer: 'https://token.actions.githubusercontent.com',
      tlogThreshold: 1,
      ctLogThreshold: 1,
    })
  })

  it('builds the verifier with exactly the pinned policy', async () => {
    await verifyCosignBundle(cosignBundle, Buffer.from('binary'))
    expect(createVerifierMock).toHaveBeenCalledWith(VERIFY_POLICY)
  })
})

describe('verifyCosignBundle', () => {
  it('verifies the binary bytes against the bundle and reports proof details', async () => {
    const proof = await verifyCosignBundle(cosignBundle, Buffer.from('binary'))
    expect(verifyMock).toHaveBeenCalledWith(cosignBundle, Buffer.from('binary'))
    expect(proof.subjectAlternativeName).toBe(SIGNER.identity.subjectAlternativeName)
    expect(proof.rekorLogIndex).toBe(cosignBundle.verificationMaterial.tlogEntries[0].logIndex)
  })

  it('propagates verification failures', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('signature verification failed')
    })
    await expect(verifyCosignBundle(cosignBundle, Buffer.from('tampered'))).rejects.toThrow(
      /signature verification failed/,
    )
  })
})

describe('verifySlsaProvenance', () => {
  it('accepts the real SLSA bundle and reports the workflow', async () => {
    const proof = await verifySlsaProvenance(allBundles, ARCHIVE, DIGEST)
    expect(proof.workflowRepository).toBe('https://github.com/bitwise-media-group/evolve')
    expect(proof.workflowPath).toBe('.github/workflows/release.yaml')
    expect(proof.subjectAlternativeName).toBe(SIGNER.identity.subjectAlternativeName)
  })

  it('skips non-SLSA predicates (e.g. GitHub release attestations)', async () => {
    // Reversed order: the release attestation comes first and must be skipped.
    const proof = await verifySlsaProvenance([...allBundles].reverse(), ARCHIVE, DIGEST)
    expect(proof.workflowPath).toBe('.github/workflows/release.yaml')
  })

  it('rejects when the digest is not among the statement subjects', async () => {
    await expect(verifySlsaProvenance(allBundles, ARCHIVE, 'f'.repeat(64))).rejects.toThrow(
      /subjects do not include/,
    )
  })

  it('rejects when the subject name does not match', async () => {
    await expect(
      verifySlsaProvenance(allBundles, 'evolve_0.1.0_linux_amd64.zip', DIGEST),
    ).rejects.toThrow(/no SLSA provenance attestation verified/)
  })

  it('rejects when signature verification fails for every bundle', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('untrusted signer')
    })
    await expect(verifySlsaProvenance(allBundles, ARCHIVE, DIGEST)).rejects.toThrow(
      /untrusted signer/,
    )
  })

  it('rejects an empty attestation list', async () => {
    await expect(verifySlsaProvenance([], ARCHIVE, DIGEST)).rejects.toThrow(
      /no SLSA provenance attestations found/,
    )
  })

  it('rejects provenance from a different workflow', async () => {
    const tampered = structuredClone(allBundles)
    const statement = JSON.parse(
      Buffer.from(tampered[0].dsseEnvelope.payload, 'base64').toString('utf8'),
    )
    statement.predicate.buildDefinition.externalParameters.workflow.path =
      '.github/workflows/evil.yaml'
    tampered[0].dsseEnvelope.payload = Buffer.from(JSON.stringify(statement)).toString('base64')
    await expect(verifySlsaProvenance(tampered, ARCHIVE, DIGEST)).rejects.toThrow(
      /workflow mismatch/,
    )
  })
})
