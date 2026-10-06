/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

// Parses a GoReleaser checksums.txt: one `<sha256-hex>  <filename>` per line.
// A leading `*` on the filename (sha256sum binary-mode convention) is ignored.
export function parseChecksums(content: string): Map<string, string> {
  const checksums = new Map<string, string>()
  for (const line of content.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const [digest, name] = parts
    if (!digest || !name) continue
    checksums.set(name.replace(/^\*/, ''), digest.toLowerCase())
  }
  return checksums
}

export function assertChecksum(
  checksums: Map<string, string>,
  filename: string,
  actualHex: string,
): void {
  const expected = checksums.get(filename)
  if (!expected) {
    throw new Error(`checksums.txt has no entry for ${filename}`)
  }
  if (expected !== actualHex.toLowerCase()) {
    throw new Error(
      `checksum mismatch for ${filename}: checksums.txt says ${expected}, got ${actualHex}`,
    )
  }
}

// Cross-checks the digest GitHub computed at asset-upload time against the
// downloaded bytes. Fails closed when the API omits the digest.
export function assertApiDigest(
  apiDigest: string | null,
  actualHex: string,
  assetName: string,
): void {
  if (!apiDigest) {
    throw new Error(`release asset ${assetName} has no digest in the GitHub API response`)
  }
  const expected = apiDigest.toLowerCase()
  const actual = `sha256:${actualHex.toLowerCase()}`
  if (expected !== actual) {
    throw new Error(`API digest mismatch for ${assetName}: API says ${expected}, got ${actual}`)
  }
}
