// Real cryptographic verification against live evolve v0.1.0 release assets.
// Network-bound and therefore gated: RUN_INTEGRATION=1 npx vitest run
// Set SIGSTORE_TUF_FORCE_CACHE=1 to verify with the TUF root seeded in the
// sigstore package instead of refreshing from tuf-repo-cdn.sigstore.dev
// (useful on egress-restricted machines).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Bundle, createVerifier, type VerifyOptions } from 'sigstore'
import { describe, expect, it } from 'vitest'
import { SLSA_PREDICATE_TYPE } from '../../src/constants'
import { createOctokit, fetchAttestations } from '../../src/github'
import { parseChecksums } from '../../src/verify/digests'
import { getVerifier, VERIFY_POLICY, verifySlsaProvenance } from '../../src/verify/sigstore'

const VERSION = '0.1.0'
const PLATFORMS: Record<string, { asset: string; bundle: string }> = {
  'linux-x64': {
    asset: `evolve_${VERSION}_linux_amd64.tar.gz`,
    bundle: 'evolve_linux_amd64.sigstore.json',
  },
  'darwin-arm64': {
    asset: `evolve_${VERSION}_darwin_arm64.tar.gz`,
    bundle: 'evolve_darwin_arm64.sigstore.json',
  },
}

const platformKey = `${process.platform}-${process.arch}`
const target = PLATFORMS[platformKey]

describe.skipIf(!process.env.RUN_INTEGRATION || !target)('real sigstore verification', () => {
  it('verifies the released binary against its committed cosign bundle', async () => {
    if (!target) throw new Error('unreachable')
    const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'evolve-it-'))
    let archive = process.env.EVOLVE_ARCHIVE_PATH // pre-downloaded archive escape hatch
    if (!archive) {
      const url = `https://github.com/bitwise-media-group/evolve/releases/download/v${VERSION}/${target.asset}`
      const res = await fetch(url)
      expect(res.ok).toBe(true)
      archive = join(dir, target.asset)
      const { writeFileSync } = await import('node:fs')
      writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
    }
    execFileSync('tar', ['-xzf', archive, '-C', dir])
    const binary = readFileSync(join(dir, 'evolve'))

    const bundle: Bundle = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'fixtures', target.bundle), 'utf8'),
    )

    const options: VerifyOptions = { ...VERIFY_POLICY }
    if (process.env.SIGSTORE_TUF_FORCE_CACHE === '1') {
      options.tufForceCache = true
      options.tufCachePath = join(dir, 'tuf-cache')
    }
    const verifier = await createVerifier(options)

    // Happy path: the genuine binary verifies under the pinned policy.
    const signer = verifier.verify(bundle, binary)
    expect(signer.identity?.subjectAlternativeName).toBe(
      'https://github.com/bitwise-media-group/evolve/.github/workflows/release.yaml@refs/heads/main',
    )

    // Negative path: a single flipped byte must fail verification.
    const tampered = Buffer.from(binary)
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0)
    expect(() => verifier.verify(bundle, tampered)).toThrow()
  })

  // Exercises the full live attestation path introduced by API version
  // 2026-03-10: versioned API request, bundle_url blob download, snappy
  // decompression, then real SLSA provenance verification. Needs a token
  // because @actions/github refuses to build an unauthenticated client.
  it.skipIf(!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN)(
    'fetches live attestations via bundle_url and verifies provenance',
    async () => {
      if (!target) throw new Error('unreachable')
      if (process.env.SIGSTORE_TUF_FORCE_CACHE === '1') {
        const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'evolve-it-'))
        await getVerifier({ tufForceCache: true, tufCachePath: join(dir, 'tuf-cache') })
      }
      const res = await fetch(
        `https://github.com/bitwise-media-group/evolve/releases/download/v${VERSION}/checksums.txt`,
      )
      expect(res.ok).toBe(true)
      const digest = parseChecksums(await res.text()).get(target.asset)
      if (!digest) throw new Error(`no checksum entry for ${target.asset}`)

      const octokit = createOctokit(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '')
      const bundles = await fetchAttestations(octokit, digest, SLSA_PREDICATE_TYPE)
      expect(bundles.length).toBeGreaterThan(0)

      const proof = await verifySlsaProvenance(bundles, target.asset, digest)
      expect(proof.workflowRepository).toBe('https://github.com/bitwise-media-group/evolve')
      expect(proof.workflowPath).toBe('.github/workflows/release.yaml')
    },
  )
})
