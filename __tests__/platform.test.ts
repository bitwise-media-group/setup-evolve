/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import { archiveName, binaryName, bundleName, getPlatform } from '../src/platform'

describe('getPlatform', () => {
  it.each([
    ['linux', 'x64', { os: 'linux', arch: 'amd64' }],
    ['linux', 'arm64', { os: 'linux', arch: 'arm64' }],
    ['darwin', 'x64', { os: 'darwin', arch: 'amd64' }],
    ['darwin', 'arm64', { os: 'darwin', arch: 'arm64' }],
    ['win32', 'x64', { os: 'windows', arch: 'amd64' }],
    ['win32', 'arm64', { os: 'windows', arch: 'arm64' }],
  ])('maps %s/%s', (platform, arch, expected) => {
    expect(getPlatform(platform, arch)).toEqual(expected)
  })

  it('rejects unsupported platforms and architectures', () => {
    expect(() => getPlatform('freebsd', 'x64')).toThrow(/unsupported platform/)
    expect(() => getPlatform('linux', 'ia32')).toThrow(/unsupported architecture/)
  })
})

describe('asset names', () => {
  it('builds GoReleaser archive names', () => {
    expect(archiveName('0.1.0', { os: 'linux', arch: 'amd64' })).toBe(
      'evolve_0.1.0_linux_amd64.tar.gz',
    )
    expect(archiveName('0.1.0', { os: 'windows', arch: 'arm64' })).toBe(
      'evolve_0.1.0_windows_arm64.zip',
    )
  })

  it('builds unversioned sigstore bundle names', () => {
    expect(bundleName({ os: 'darwin', arch: 'arm64' })).toBe('evolve_darwin_arm64.sigstore.json')
  })

  it('appends .exe on windows only', () => {
    expect(binaryName('windows')).toBe('evolve.exe')
    expect(binaryName('linux')).toBe('evolve')
  })
})
