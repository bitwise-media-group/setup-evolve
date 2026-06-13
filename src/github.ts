import * as github from '@actions/github'
import { uncompress } from 'snappyjs'
import { EVOLVE_OWNER, EVOLVE_REPO, GITHUB_API_VERSION } from './constants'

export type Octokit = ReturnType<typeof github.getOctokit>

export interface ReleaseAsset {
  name: string
  // API asset URL (api.github.com/...): downloads work for public and private
  // repos when requested with `Accept: application/octet-stream`.
  url: string
  // `sha256:<hex>` digest computed by GitHub at upload time.
  digest: string | null
}

export interface Release {
  tag: string
  prerelease: boolean
  assets: ReleaseAsset[]
}

export function createOctokit(token: string): Octokit {
  return github.getOctokit(token)
}

// biome-ignore lint/suspicious/noExplicitAny: GitHub API payloads are mapped defensively
function toRelease(r: any): Release {
  return {
    tag: r.tag_name,
    prerelease: Boolean(r.prerelease),
    // biome-ignore lint/suspicious/noExplicitAny: see above
    assets: (r.assets ?? []).map((a: any) => ({
      name: a.name,
      url: a.url,
      digest: a.digest ?? null,
    })),
  }
}

// Lists all non-draft releases. Drafts never appear for the workflow token,
// but filter anyway in case a broader token is supplied.
export async function listReleases(octokit: Octokit): Promise<Release[]> {
  const releases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner: EVOLVE_OWNER,
    repo: EVOLVE_REPO,
    per_page: 100,
  })
  // biome-ignore lint/suspicious/noExplicitAny: GitHub API payloads are mapped defensively
  return releases.filter((r: any) => !r.draft).map(toRelease)
}

export async function getReleaseByTag(octokit: Octokit, tag: string): Promise<Release> {
  try {
    const { data } = await octokit.rest.repos.getReleaseByTag({
      owner: EVOLVE_OWNER,
      repo: EVOLVE_REPO,
      tag,
    })
    return toRelease(data)
  } catch (err) {
    if (err instanceof Error && 'status' in err && err.status === 404) {
      throw new Error(`no evolve release found for tag ${tag}`)
    }
    throw err
  }
}

export function findAsset(release: Release, name: string): ReleaseAsset {
  const asset = release.assets.find((a) => a.name === name)
  if (!asset) {
    const available = release.assets.map((a) => a.name).join(', ')
    throw new Error(`release ${release.tag} has no asset named ${name} (available: ${available})`)
  }
  return asset
}

// Fetches sigstore bundles attested for the given subject digest, filtered
// server-side by predicate type. Returns the raw serialized bundles.
// As of API version 2026-03-10 the response carries `bundle_url` instead of an
// inline `bundle`; the inline field is still honored as a fallback (matching
// gh CLI) in case a response predates the version cutover.
export async function fetchAttestations(
  octokit: Octokit,
  digestHex: string,
  predicateType: string,
): Promise<unknown[]> {
  const res = await octokit.request('GET /repos/{owner}/{repo}/attestations/{subject_digest}', {
    owner: EVOLVE_OWNER,
    repo: EVOLVE_REPO,
    subject_digest: `sha256:${digestHex}`,
    predicate_type: predicateType,
    per_page: 100,
    headers: { 'x-github-api-version': GITHUB_API_VERSION },
  })
  return Promise.all(
    // biome-ignore lint/suspicious/noExplicitAny: GitHub API payloads are mapped defensively
    (res.data.attestations ?? []).map((a: any) => {
      if (a.bundle != null) return a.bundle
      if (typeof a.bundle_url !== 'string' || a.bundle_url === '') {
        throw new Error('attestation has neither a bundle nor a bundle URL')
      }
      return fetchBundle(a.bundle_url)
    }),
  )
}

// `bundle_url` is a pre-signed blob-storage URL: fetched without GitHub
// credentials, and the body is a snappy-compressed JSON sigstore bundle.
async function fetchBundle(bundleUrl: string): Promise<unknown> {
  const res = await fetch(bundleUrl)
  if (!res.ok) {
    throw new Error(`attestation bundle download failed with status ${res.status}`)
  }
  const compressed = new Uint8Array(await res.arrayBuffer())
  return JSON.parse(Buffer.from(uncompress(compressed)).toString('utf8'))
}
