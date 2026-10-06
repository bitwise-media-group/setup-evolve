/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import { evictInstall, restoreFromActionsCache, saveToActionsCache, toolDir } from './cache'
import { TOOL_NAME } from './constants'
import { errorMessage } from './error'
import { createOctokit } from './github'
import { getInputs } from './inputs'
import { downloadAndVerify, reverifyInstall } from './install'
import { getPlatform } from './platform'
import { type CacheHit, writeSummary } from './summary'
import { resolveVersion } from './version'

export async function run(): Promise<void> {
  const inputs = getInputs()
  const platform = getPlatform()
  const octokit = createOctokit(inputs.githubToken)

  const { version, release } = await resolveVersion(octokit, inputs.version, inputs.preRelease)
  core.info(`Resolved evolve ${inputs.version} -> ${version} (${release.tag})`)

  let installDir: string | undefined
  let cacheHit: CacheHit = 'false'

  // 1. Runner tool cache (persists between jobs on self-hosted runners).
  const found = tc.find(TOOL_NAME, version, platform.arch)
  if (found) {
    try {
      const cosign = await reverifyInstall(found, platform)
      installDir = found
      cacheHit = 'tool-cache'
      core.info(`✓ Re-verified tool-cache installation at ${found}`)
      await writeSummary(version, cacheHit, { installDir, cosign })
    } catch (err) {
      core.warning(
        `Tool-cache installation at ${found} failed re-verification and was discarded: ${errorMessage(err)}`,
      )
      await evictInstall(version, platform)
    }
  }

  // 2. GitHub Actions cache, re-verified against the bundled signature.
  if (!installDir && inputs.cache) {
    const restored = await restoreFromActionsCache(version, platform)
    if (restored) {
      const dir = toolDir(version, platform)
      try {
        const cosign = await reverifyInstall(dir, platform)
        installDir = dir
        cacheHit = 'cache'
        core.info(`✓ Re-verified Actions-cache installation at ${dir}`)
        await writeSummary(version, cacheHit, { installDir, cosign })
      } catch (err) {
        core.warning(
          `Actions cache entry for evolve ${version} failed re-verification and was discarded: ${errorMessage(err)}`,
        )
        await evictInstall(version, platform)
      }
    }
  }

  // 3. Fresh download with full verification.
  if (!installDir) {
    const result = await downloadAndVerify(octokit, release, version, platform, inputs.githubToken)
    installDir = result.installDir
    if (inputs.cache) {
      await saveToActionsCache(version, platform)
    }
    await writeSummary(version, cacheHit, result)
  }

  core.addPath(installDir)
  core.setOutput('version', version)
  core.setOutput('path', installDir)
  core.setOutput('cache-hit', cacheHit)
  core.info(`evolve ${version} ready at ${installDir}`)
}

run().catch((err: unknown) => {
  core.setFailed(errorMessage(err))
})
