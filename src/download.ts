/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import * as tc from '@actions/tool-cache'
import type { ReleaseAsset } from './github'
import type { Os } from './platform'

// Downloads through the asset API endpoint (works for public and private
// repos, and authenticated requests avoid shared-runner IP rate limits).
export async function downloadReleaseAsset(asset: ReleaseAsset, token: string): Promise<string> {
  return await tc.downloadTool(asset.url, undefined, `token ${token}`, {
    accept: 'application/octet-stream',
  })
}

export async function extractArchive(archivePath: string, os: Os): Promise<string> {
  if (os === 'windows') {
    // downloadTool saves to an extension-less temp path; extractZip on
    // Windows requires a .zip suffix for PowerShell's Expand-Archive.
    let zipPath = archivePath
    if (!zipPath.endsWith('.zip')) {
      zipPath = `${archivePath}.zip`
      await fs.rename(archivePath, zipPath)
    }
    return await tc.extractZip(zipPath)
  }
  return await tc.extractTar(archivePath)
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}
