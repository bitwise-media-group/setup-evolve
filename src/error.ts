/**
 * Copyright 2026 BitWise Media Group Ltd
 * SPDX-License-Identifier: MIT
 */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
