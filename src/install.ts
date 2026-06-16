import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import { SLSA_PREDICATE_TYPE, TOOL_NAME, VERIFICATION_DIR } from './constants'
import { downloadReleaseAsset, extractArchive, sha256File } from './download'
import { fetchAttestations, findAsset, type Octokit, type Release } from './github'
import { archiveName, binaryName, bundleName, type Platform } from './platform'
import { assertApiDigest, assertChecksum, parseChecksums } from './verify/digests'
import {
  type ProvenanceProof,
  type SignatureProof,
  verifyCosignBundle,
  verifySlsaProvenance,
} from './verify/sigstore'

export interface InstallResult {
  installDir: string
  archiveDigest: string
  provenance: ProvenanceProof
  cosign: SignatureProof
}

// Fresh-download path: download the archive and verify it (API digest,
// checksums.txt, SLSA provenance), extract, verify the binary's cosign
// signature, then install into the runner tool cache with the verification
// material stored alongside for later re-verification.
export async function downloadAndVerify(
  octokit: Octokit,
  release: Release,
  version: string,
  platform: Platform,
  token: string,
): Promise<InstallResult> {
  const archive = findAsset(release, archiveName(version, platform))
  const checksumsAsset = findAsset(release, 'checksums.txt')
  const sigBundleAsset = findAsset(release, bundleName(platform))

  core.info(`Downloading ${archive.name} from release ${release.tag}`)
  const archivePath = await downloadReleaseAsset(archive, token)
  const digest = await sha256File(archivePath)
  core.info(`Archive sha256: ${digest}`)

  assertApiDigest(archive.digest, digest, archive.name)
  core.info('✓ GitHub API asset digest matches')

  const checksumsPath = await downloadReleaseAsset(checksumsAsset, token)
  const checksums = parseChecksums(await fs.readFile(checksumsPath, 'utf8'))
  assertChecksum(checksums, archive.name, digest)
  core.info('✓ checksums.txt entry matches')

  const attestations = await fetchAttestations(octokit, digest, SLSA_PREDICATE_TYPE)
  const provenance = await verifySlsaProvenance(attestations, archive.name, digest)
  core.info(
    `✓ SLSA build provenance verified (signer: ${provenance.subjectAlternativeName}, Rekor index: ${provenance.rekorLogIndex})`,
  )

  const extractDir = await extractArchive(archivePath, platform.os)
  const binaryPath = path.join(extractDir, binaryName(platform.os))
  // Read the extracted binary directly rather than probing with fs.access
  // first: a separate check-then-use is a TOCTOU race, and readFile already
  // throws (ENOENT) if extraction did not produce the expected binary.
  const binary = await fs.readFile(binaryPath)

  const bundlePath = await downloadReleaseAsset(sigBundleAsset, token)
  const bundleJson: unknown = JSON.parse(await fs.readFile(bundlePath, 'utf8'))
  const cosign = await verifyCosignBundle(bundleJson, binary)
  core.info(
    `✓ cosign signature over the binary verified (signer: ${cosign.subjectAlternativeName}, Rekor index: ${cosign.rekorLogIndex})`,
  )

  if (platform.os !== 'windows') {
    await fs.chmod(binaryPath, 0o755)
  }

  // Stash the cosign bundle and install metadata inside the installed dir so
  // cache restores can be re-verified offline from GitHub's API.
  const verificationDir = path.join(extractDir, VERIFICATION_DIR)
  await fs.mkdir(verificationDir, { recursive: true })
  await fs.copyFile(bundlePath, path.join(verificationDir, 'evolve.sigstore.json'))
  await fs.writeFile(
    path.join(verificationDir, 'metadata.json'),
    JSON.stringify(
      {
        version,
        archive: archive.name,
        archiveDigest: `sha256:${digest}`,
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  const installDir = await tc.cacheDir(extractDir, TOOL_NAME, version, platform.arch)
  return { installDir, archiveDigest: digest, provenance, cosign }
}

// Re-verifies a cached installation (runner tool cache or Actions cache)
// against the cosign bundle stored at install time. The trust anchors (TUF
// roots, pinned identity) live outside the cache, so a poisoned cache entry
// cannot produce a binary that passes. Returns the proof, or throws.
export async function reverifyInstall(
  installDir: string,
  platform: Platform,
): Promise<SignatureProof> {
  const binaryPath = path.join(installDir, binaryName(platform.os))
  const bundlePath = path.join(installDir, VERIFICATION_DIR, 'evolve.sigstore.json')
  const bundleJson: unknown = JSON.parse(await fs.readFile(bundlePath, 'utf8'))
  const binary = await fs.readFile(binaryPath)
  return await verifyCosignBundle(bundleJson, binary)
}
