/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

import * as core from '@actions/core'

export interface Inputs {
  version: string
  preRelease: boolean
  githubToken: string
  cache: boolean
}

export function getInputs(): Inputs {
  return {
    version: core.getInput('version') || 'latest',
    preRelease: core.getBooleanInput('pre-release'),
    githubToken: core.getInput('github-token', { required: true }),
    cache: core.getBooleanInput('cache'),
  }
}
