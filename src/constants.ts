export const EVOLVE_OWNER = 'bitwise-media-group'
export const EVOLVE_REPO = 'evolve'
export const TOOL_NAME = 'evolve'

// REST API version for attestation requests. 2026-03-10 drops the inline
// `bundle` field (bundles are fetched via `bundle_url` instead); the prior
// version sunsets 2028-03-10.
export const GITHUB_API_VERSION = '2026-03-10'

// Bump whenever the cached directory layout or verification material changes;
// invalidates every previously saved Actions cache entry.
export const CACHE_SCHEMA_VERSION = '1'

// Identity of evolve's release pipeline. The URI is a regex tested against the
// full certificate SAN (sigstore-js semantics), so it must stay anchored and
// dot-escaped; the issuer is compared exactly. If evolve's release workflow is
// ever renamed or re-triggered from another ref, these constants must be
// updated in lockstep — installs hard-fail until then, by design.
export const CERT_IDENTITY_URI = String.raw`^https://github\.com/bitwise-media-group/evolve/\.github/workflows/release\.yaml@refs/heads/main$`
export const CERT_ISSUER = 'https://token.actions.githubusercontent.com'
export const WORKFLOW_REPOSITORY = `https://github.com/${EVOLVE_OWNER}/${EVOLVE_REPO}`
export const WORKFLOW_PATH = '.github/workflows/release.yaml'

export const SLSA_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1'
export const INTOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1'

// Subdirectory inside the installed tool dir holding the cosign bundle and
// install metadata, so cache restores can be re-verified without API calls.
export const VERIFICATION_DIR = '.setup-evolve'
