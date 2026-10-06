/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import * as core from '@actions/core'
import type { InstallResult } from './install'
import type { SignatureProof } from './verify/sigstore'

export type CacheHit = 'tool-cache' | 'cache' | 'false'

export async function writeSummary(
  version: string,
  cacheHit: CacheHit,
  result: InstallResult | { installDir: string; cosign: SignatureProof },
): Promise<void> {
  if (!process.env.GITHUB_STEP_SUMMARY) return

  const rows: string[][] = [
    ['Resolved version', version],
    ['Source', cacheHit === 'false' ? 'verified download' : `${cacheHit} (re-verified)`],
  ]

  if ('archiveDigest' in result) {
    rows.push(
      ['Archive sha256', `\`${result.archiveDigest}\``],
      ['GitHub API asset digest', '✅ match'],
      ['checksums.txt', '✅ match'],
      [
        'SLSA build provenance',
        `✅ verified — signer \`${result.provenance.subjectAlternativeName}\`, Rekor index ${result.provenance.rekorLogIndex}`,
      ],
    )
  }
  rows.push([
    'Cosign binary signature',
    `✅ verified — signer \`${result.cosign.subjectAlternativeName}\`, Rekor index ${result.cosign.rekorLogIndex}`,
  ])

  await core.summary
    .addHeading('setup-evolve verification', 3)
    .addTable([
      [
        { data: 'Check', header: true },
        { data: 'Result', header: true },
      ],
      ...rows,
    ])
    .write()
}
