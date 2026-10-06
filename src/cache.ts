/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import * as path from 'node:path'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as io from '@actions/io'
import { CACHE_SCHEMA_VERSION, TOOL_NAME } from './constants'
import type { Platform } from './platform'

export function cacheKey(version: string, { os, arch }: Platform): string {
  return `setup-evolve-${CACHE_SCHEMA_VERSION}-${version}-${os}-${arch}`
}

// The directory tc.cacheDir() creates and tc.find() looks up, plus the
// `.complete` marker tc.find() requires next to it. Both must round-trip
// through the Actions cache for a restore to register as installed.
export function toolDir(version: string, { arch }: Platform): string {
  const root = process.env.RUNNER_TOOL_CACHE
  if (!root) throw new Error('RUNNER_TOOL_CACHE is not defined')
  return path.join(root, TOOL_NAME, version, arch)
}

export function toolPaths(version: string, platform: Platform): string[] {
  const dir = toolDir(version, platform)
  return [dir, `${dir}.complete`]
}

export async function restoreFromActionsCache(
  version: string,
  platform: Platform,
): Promise<boolean> {
  if (!cache.isFeatureAvailable()) {
    core.info('GitHub Actions cache service is not available; skipping restore')
    return false
  }
  // Exact key only — no restoreKeys prefix fallback: another version is
  // useless here, and prefix matching widens the cache-poisoning surface.
  const hit = await cache.restoreCache(toolPaths(version, platform), cacheKey(version, platform))
  return hit !== undefined
}

export async function saveToActionsCache(version: string, platform: Platform): Promise<void> {
  if (!cache.isFeatureAvailable()) {
    core.info('GitHub Actions cache service is not available; skipping save')
    return
  }
  const key = cacheKey(version, platform)
  try {
    await cache.saveCache(toolPaths(version, platform), key)
    core.info(`Saved verified installation to Actions cache (${key})`)
  } catch (err) {
    if (err instanceof cache.ReserveCacheError) {
      core.debug(`Actions cache entry already reserved: ${err.message}`)
      return
    }
    throw err
  }
}

// Removes a cached installation that failed re-verification so the run can
// fall through to a fresh, fully verified download.
export async function evictInstall(version: string, platform: Platform): Promise<void> {
  for (const p of toolPaths(version, platform)) {
    await io.rmRF(p)
  }
}
