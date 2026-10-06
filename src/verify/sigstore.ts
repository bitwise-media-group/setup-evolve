/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import { type Bundle, type BundleVerifier, createVerifier, type VerifyOptions } from 'sigstore'
import {
  CERT_IDENTITY_URI,
  CERT_ISSUER,
  INTOTO_STATEMENT_TYPE,
  SLSA_PREDICATE_TYPE,
  WORKFLOW_PATH,
  WORKFLOW_REPOSITORY,
} from '../constants'
import { errorMessage } from '../error'

// The single verification policy applied to every sigstore bundle this action
// accepts: certificate chains to the public-good Fulcio, the signing identity
// is evolve's release workflow on main, and inclusion in Rekor plus a CT log
// entry are mandatory.
export const VERIFY_POLICY: VerifyOptions = {
  certificateIdentityURI: CERT_IDENTITY_URI,
  certificateIssuer: CERT_ISSUER,
  tlogThreshold: 1,
  ctLogThreshold: 1,
}

// Building a verifier refreshes Sigstore TUF trust material (network call to
// tuf-repo-cdn.sigstore.dev); share one instance across all verifications.
let verifierPromise: Promise<BundleVerifier> | undefined

export function getVerifier(extraOptions?: VerifyOptions): Promise<BundleVerifier> {
  if (!verifierPromise) {
    verifierPromise = createVerifier({ ...VERIFY_POLICY, ...extraOptions })
  }
  return verifierPromise
}

export interface SignatureProof {
  subjectAlternativeName: string | undefined
  rekorLogIndex: string | undefined
}

function rekorLogIndex(bundle: unknown): string | undefined {
  // biome-ignore lint/suspicious/noExplicitAny: serialized bundle inspected for display only
  return (bundle as any)?.verificationMaterial?.tlogEntries?.[0]?.logIndex
}

// Verifies the cosign keyless signature over the extracted binary bytes.
export async function verifyCosignBundle(
  bundleJson: unknown,
  binary: Buffer,
): Promise<SignatureProof> {
  const verifier = await getVerifier()
  const signer = verifier.verify(bundleJson as Bundle, binary)
  return {
    subjectAlternativeName: signer.identity?.subjectAlternativeName,
    rekorLogIndex: rekorLogIndex(bundleJson),
  }
}

export interface ProvenanceProof extends SignatureProof {
  workflowRepository: string
  workflowPath: string
}

interface InTotoStatement {
  _type?: string
  predicateType?: string
  subject?: { name?: string; digest?: Record<string, string> }[]
  predicate?: {
    buildDefinition?: {
      externalParameters?: {
        workflow?: { repository?: string; path?: string; ref?: string }
      }
    }
  }
}

function decodeStatement(bundleJson: unknown): InTotoStatement {
  // biome-ignore lint/suspicious/noExplicitAny: payload shape asserted below
  const payload = (bundleJson as any)?.dsseEnvelope?.payload
  if (typeof payload !== 'string') {
    throw new Error('attestation bundle has no DSSE payload')
  }
  return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
}

// Verifies that at least one SLSA build-provenance attestation covers the
// archive: signature and identity check out, the statement names the archive
// with the digest we computed, and the provenance says it was built by
// evolve's release workflow.
export async function verifySlsaProvenance(
  bundles: unknown[],
  subjectName: string,
  subjectDigestHex: string,
): Promise<ProvenanceProof> {
  if (bundles.length === 0) {
    throw new Error(
      `no SLSA provenance attestations found for ${subjectName} (sha256:${subjectDigestHex})`,
    )
  }

  const verifier = await getVerifier()
  const failures: string[] = []

  for (const bundleJson of bundles) {
    try {
      const signer = verifier.verify(bundleJson as Bundle)

      const statement = decodeStatement(bundleJson)
      if (statement._type !== INTOTO_STATEMENT_TYPE) {
        throw new Error(`unexpected statement type ${statement._type}`)
      }
      if (statement.predicateType !== SLSA_PREDICATE_TYPE) {
        // A non-SLSA attestation (e.g. GitHub's release attestation) that
        // slipped past the server-side predicate filter: not an error, just
        // not the proof we need.
        continue
      }

      const digest = subjectDigestHex.toLowerCase()
      const covered = (statement.subject ?? []).some(
        (s) => s.name === subjectName && s.digest?.sha256?.toLowerCase() === digest,
      )
      if (!covered) {
        throw new Error(`statement subjects do not include ${subjectName}@sha256:${digest}`)
      }

      const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow
      if (workflow?.repository !== WORKFLOW_REPOSITORY || workflow?.path !== WORKFLOW_PATH) {
        throw new Error(
          `provenance workflow mismatch: ${workflow?.repository ?? '<none>'} @ ${workflow?.path ?? '<none>'}`,
        )
      }

      return {
        subjectAlternativeName: signer.identity?.subjectAlternativeName,
        rekorLogIndex: rekorLogIndex(bundleJson),
        workflowRepository: workflow.repository,
        workflowPath: workflow.path,
      }
    } catch (err) {
      failures.push(errorMessage(err))
    }
  }

  throw new Error(
    `no SLSA provenance attestation verified for ${subjectName}: ${failures.join('; ') || 'none matched'}`,
  )
}
