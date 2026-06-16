import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Octokit, Release, ReleaseAsset } from '../src/github'
import type { Platform } from '../src/platform'

// Mocks for everything around the extract→read→verify step. The real
// node:fs/promises and node:path are left intact so the actual binary read
// runs against a real temp directory — that read is the behaviour under test.
const downloadReleaseAsset = vi.fn<(asset: ReleaseAsset, token: string) => Promise<string>>()
const extractArchive = vi.fn<() => Promise<string>>()
const sha256File = vi.fn(async () => 'a'.repeat(64))
const findAsset = vi.fn(
  (_release: Release, name: string): ReleaseAsset => ({
    name,
    url: `https://api.github.com/assets/${name}`,
    digest: 'sha256:apidigest',
  }),
)
const fetchAttestations = vi.fn(async () => [] as unknown[])
const assertApiDigest = vi.fn()
const assertChecksum = vi.fn()
const parseChecksums = vi.fn(() => new Map<string, string>())
const verifyCosignBundle = vi.fn(async (_bundleJson: unknown, _binary: Buffer) => ({
  subjectAlternativeName: 'signer',
  rekorLogIndex: '1',
}))
const verifySlsaProvenance = vi.fn(async () => ({
  subjectAlternativeName: 'signer',
  rekorLogIndex: '1',
  workflowRepository: 'https://github.com/bitwise-media-group/evolve',
  workflowPath: '.github/workflows/release.yaml',
}))
const cacheDir = vi.fn(async () => '/opt/hostedtoolcache/evolve/0.1.0/amd64')

// Keep every fs operation real (they run against the temp dir) but wrap
// access() so the test can assert the removed check-then-use probe never runs.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const access = vi.fn(actual.access)
  return { ...actual, access, default: { ...actual, access } }
})

vi.mock('@actions/core', () => ({ info: vi.fn() }))
vi.mock('@actions/tool-cache', () => ({ cacheDir }))
vi.mock('../src/download', () => ({ downloadReleaseAsset, extractArchive, sha256File }))
vi.mock('../src/github', () => ({ findAsset, fetchAttestations }))
vi.mock('../src/verify/digests', () => ({ assertApiDigest, assertChecksum, parseChecksums }))
vi.mock('../src/verify/sigstore', () => ({ verifyCosignBundle, verifySlsaProvenance }))

const { downloadAndVerify } = await import('../src/install')

const PLATFORM: Platform = { os: 'linux', arch: 'amd64' }
const RELEASE = { tag: 'v0.1.0', prerelease: false, assets: [] } as Release
const OCTOKIT = {} as unknown as Octokit
const BINARY = Buffer.from('\x7fELF fake evolve binary bytes')

const wasBundleDownloaded = () =>
  downloadReleaseAsset.mock.calls.some(([asset]) => asset.name.endsWith('.sigstore.json'))

describe('downloadAndVerify — reading the extracted binary', () => {
  let tmp: string
  let extractDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmp = mkdtempSync(join(tmpdir(), 'setup-evolve-install-'))
    extractDir = join(tmp, 'extract')
    mkdirSync(extractDir, { recursive: true })

    // checksums.txt and the cosign bundle are read with the real fs, so they
    // must be real files; their parsed contents are stubbed out via mocks.
    const checksumsPath = join(tmp, 'checksums.txt')
    const bundlePath = join(tmp, 'evolve_linux_amd64.sigstore.json')
    writeFileSync(checksumsPath, 'stub checksums\n')
    writeFileSync(bundlePath, JSON.stringify({ mock: 'bundle' }))

    extractArchive.mockResolvedValue(extractDir)
    downloadReleaseAsset.mockImplementation(async (asset) => {
      if (asset.name.endsWith('.tar.gz')) return join(tmp, asset.name) // never read (extract is mocked)
      if (asset.name === 'checksums.txt') return checksumsPath
      if (asset.name.endsWith('.sigstore.json')) return bundlePath
      throw new Error(`unexpected asset download: ${asset.name}`)
    })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('reads the extracted binary and passes its bytes to cosign verification', async () => {
    writeFileSync(join(extractDir, 'evolve'), BINARY)

    const result = await downloadAndVerify(OCTOKIT, RELEASE, '0.1.0', PLATFORM, 'token')

    expect(result.installDir).toBe('/opt/hostedtoolcache/evolve/0.1.0/amd64')
    expect(result.archiveDigest).toBe('a'.repeat(64))
    expect(cacheDir).toHaveBeenCalledWith(extractDir, 'evolve', '0.1.0', 'amd64')

    // The verifier must receive the parsed bundle and the exact bytes read
    // from disk — proving the direct readFile feeds verification.
    expect(verifyCosignBundle).toHaveBeenCalledTimes(1)
    const call = verifyCosignBundle.mock.calls[0]
    expect(call).toBeDefined()
    const [bundleArg, binaryArg] = call!
    expect(bundleArg).toEqual({ mock: 'bundle' })
    expect(Buffer.isBuffer(binaryArg)).toBe(true)
    expect(binaryArg.equals(BINARY)).toBe(true)

    // The binary is read directly, never probed with a separate fs.access
    // check-then-use (the TOCTOU pattern the fix removed).
    expect(vi.mocked(fs.access)).not.toHaveBeenCalled()
  })

  it('fails fast with ENOENT before downloading the bundle when the binary is missing', async () => {
    // No binary written into extractDir: the direct readFile must throw, and
    // because the read happens before the bundle download, the bundle is never
    // fetched and verification is never attempted. This pins the ordering that
    // replaced the old fs.access check-then-use (TOCTOU) probe.
    await expect(
      downloadAndVerify(OCTOKIT, RELEASE, '0.1.0', PLATFORM, 'token'),
    ).rejects.toMatchObject({ code: 'ENOENT' })

    expect(wasBundleDownloaded()).toBe(false)
    expect(verifyCosignBundle).not.toHaveBeenCalled()
  })
})
