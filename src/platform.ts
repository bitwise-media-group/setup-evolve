/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

export type Os = 'linux' | 'darwin' | 'windows'
export type Arch = 'amd64' | 'arm64'

export interface Platform {
  os: Os
  arch: Arch
}

export function getPlatform(
  nodePlatform: string = process.platform,
  nodeArch: string = process.arch,
): Platform {
  let os: Os
  switch (nodePlatform) {
    case 'linux':
      os = 'linux'
      break
    case 'darwin':
      os = 'darwin'
      break
    case 'win32':
      os = 'windows'
      break
    default:
      throw new Error(
        `unsupported platform: ${nodePlatform} (evolve supports linux, darwin, windows)`,
      )
  }

  let arch: Arch
  switch (nodeArch) {
    case 'x64':
      arch = 'amd64'
      break
    case 'arm64':
      arch = 'arm64'
      break
    default:
      throw new Error(`unsupported architecture: ${nodeArch} (evolve supports amd64, arm64)`)
  }

  return { os, arch }
}

// GoReleaser asset name templates from evolve's .goreleaser.yaml. The archive
// embeds the version (no "v" prefix); the sigstore bundle does not, so it must
// always be located via the release's own asset list.
export function archiveName(version: string, { os, arch }: Platform): string {
  const ext = os === 'windows' ? 'zip' : 'tar.gz'
  return `evolve_${version}_${os}_${arch}.${ext}`
}

export function bundleName({ os, arch }: Platform): string {
  return `evolve_${os}_${arch}.sigstore.json`
}

export function binaryName(os: Os): string {
  return os === 'windows' ? 'evolve.exe' : 'evolve'
}
