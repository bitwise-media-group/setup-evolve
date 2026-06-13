import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compress } from 'snappyjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_API_VERSION } from '../src/constants'
import { fetchAttestations, type Octokit } from '../src/github'

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8'))

// Real attestation API response captured before the 2026-03-10 version cutover,
// so each entry carries both `bundle` and `bundle_url`.
const apiResponse = fixture('attestations.json')
// biome-ignore lint/suspicious/noExplicitAny: fixture shape known
const bundles = apiResponse.attestations.map((a: any) => a.bundle)

const DIGEST = 'd8ff511609b474a2de9272523b6031b1b197863c334c272388e2a3389b4c97f6'
const PREDICATE = 'https://slsa.dev/provenance/v1'

// Snappy-compressed bundle bytes as served by the blob-storage `bundle_url`.
const blobBody = (bundle: unknown) =>
  compress(new Uint8Array(Buffer.from(JSON.stringify(bundle), 'utf8')))

function mockOctokit(attestations: unknown[]): {
  octokit: Octokit
  request: ReturnType<typeof vi.fn>
} {
  const request = vi.fn(async () => ({ data: { attestations } }))
  return { octokit: { request } as unknown as Octokit, request }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchAttestations', () => {
  it('requests the versioned API filtered by digest and predicate', async () => {
    const { octokit, request } = mockOctokit(apiResponse.attestations)
    await fetchAttestations(octokit, DIGEST, PREDICATE)
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/attestations/{subject_digest}',
      expect.objectContaining({
        owner: 'bitwise-media-group',
        repo: 'evolve',
        subject_digest: `sha256:${DIGEST}`,
        predicate_type: PREDICATE,
        headers: { 'x-github-api-version': GITHUB_API_VERSION },
      }),
    )
  })

  it('prefers inline bundles without touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { octokit } = mockOctokit(apiResponse.attestations)
    const result = await fetchAttestations(octokit, DIGEST, PREDICATE)
    expect(result).toEqual(bundles)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('downloads and snappy-decompresses bundle_url when bundle is absent', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const index = url === 'https://blob.example/0' ? 0 : 1
      return new Response(blobBody(bundles[index]))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { octokit } = mockOctokit([
      { repository_id: 1, bundle_url: 'https://blob.example/0' },
      { repository_id: 1, bundle_url: 'https://blob.example/1' },
    ])
    const result = await fetchAttestations(octokit, DIGEST, PREDICATE)
    expect(result).toEqual(bundles)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects when the bundle download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    )
    const { octokit } = mockOctokit([{ repository_id: 1, bundle_url: 'https://blob.example/0' }])
    await expect(fetchAttestations(octokit, DIGEST, PREDICATE)).rejects.toThrow(
      /bundle download failed with status 503/,
    )
  })

  it('rejects an attestation with neither bundle nor bundle_url', async () => {
    const { octokit } = mockOctokit([{ repository_id: 1 }])
    await expect(fetchAttestations(octokit, DIGEST, PREDICATE)).rejects.toThrow(
      /neither a bundle nor a bundle URL/,
    )
  })

  it('returns an empty list when the response has no attestations', async () => {
    const { octokit } = mockOctokit([])
    await expect(fetchAttestations(octokit, DIGEST, PREDICATE)).resolves.toEqual([])
  })
})
