/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const restoreCacheMock = vi.fn()
const saveCacheMock = vi.fn()
const isFeatureAvailableMock = vi.fn(() => true)

class ReserveCacheError extends Error {}

vi.mock('@actions/cache', () => ({
  restoreCache: restoreCacheMock,
  saveCache: saveCacheMock,
  isFeatureAvailable: isFeatureAvailableMock,
  ReserveCacheError,
}))

const { cacheKey, evictInstall, restoreFromActionsCache, saveToActionsCache, toolDir, toolPaths } =
  await import('../src/cache')

const PLATFORM = { os: 'linux', arch: 'amd64' } as const

describe('cache keys and paths', () => {
  beforeEach(() => {
    process.env.RUNNER_TOOL_CACHE = '/opt/hostedtoolcache'
  })

  it('builds a schema-versioned exact key', () => {
    expect(cacheKey('0.1.0', PLATFORM)).toBe('setup-evolve-1-0.1.0-linux-amd64')
  })

  it('covers the tool dir and its .complete marker', () => {
    expect(toolPaths('0.1.0', PLATFORM)).toEqual([
      '/opt/hostedtoolcache/evolve/0.1.0/amd64',
      '/opt/hostedtoolcache/evolve/0.1.0/amd64.complete',
    ])
  })

  it('fails when RUNNER_TOOL_CACHE is unset', () => {
    delete process.env.RUNNER_TOOL_CACHE
    expect(() => toolDir('0.1.0', PLATFORM)).toThrow(/RUNNER_TOOL_CACHE/)
  })
})

describe('restore/save', () => {
  beforeEach(() => {
    process.env.RUNNER_TOOL_CACHE = '/opt/hostedtoolcache'
    restoreCacheMock.mockReset()
    saveCacheMock.mockReset()
    isFeatureAvailableMock.mockReturnValue(true)
  })

  it('restores with the exact key and no restoreKeys fallback', async () => {
    restoreCacheMock.mockResolvedValue('setup-evolve-1-0.1.0-linux-amd64')
    await expect(restoreFromActionsCache('0.1.0', PLATFORM)).resolves.toBe(true)
    expect(restoreCacheMock).toHaveBeenCalledWith(
      toolPaths('0.1.0', PLATFORM),
      'setup-evolve-1-0.1.0-linux-amd64',
    )
  })

  it('reports a miss', async () => {
    restoreCacheMock.mockResolvedValue(undefined)
    await expect(restoreFromActionsCache('0.1.0', PLATFORM)).resolves.toBe(false)
  })

  it('skips when the cache service is unavailable', async () => {
    isFeatureAvailableMock.mockReturnValue(false)
    await expect(restoreFromActionsCache('0.1.0', PLATFORM)).resolves.toBe(false)
    await saveToActionsCache('0.1.0', PLATFORM)
    expect(restoreCacheMock).not.toHaveBeenCalled()
    expect(saveCacheMock).not.toHaveBeenCalled()
  })

  it('swallows ReserveCacheError on save (parallel jobs racing)', async () => {
    saveCacheMock.mockRejectedValue(new ReserveCacheError('already reserved'))
    await expect(saveToActionsCache('0.1.0', PLATFORM)).resolves.toBeUndefined()
  })

  it('propagates other save errors', async () => {
    saveCacheMock.mockRejectedValue(new Error('boom'))
    await expect(saveToActionsCache('0.1.0', PLATFORM)).rejects.toThrow('boom')
  })
})

describe('evictInstall', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'setup-evolve-test-'))
    process.env.RUNNER_TOOL_CACHE = root
  })

  afterEach(() => {
    delete process.env.RUNNER_TOOL_CACHE
  })

  it('removes the tool dir and completion marker of a rejected install', async () => {
    const { mkdirSync } = await import('node:fs')
    const dir = toolDir('0.1.0', PLATFORM)
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}.complete`, '')
    await evictInstall('0.1.0', PLATFORM)
    expect(existsSync(dir)).toBe(false)
    expect(existsSync(`${dir}.complete`)).toBe(false)
  })
})
