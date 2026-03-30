import { createHash } from 'node:crypto';

/**
 * Builds a stable, deterministic session key without exposing token fragments.
 */
export function buildSessionId(apiUrl: string, apiToken?: string): string {
  if (!apiToken) {
    return 'anonymous';
  }

  const tokenFingerprint = createHash('sha256')
    .update(apiToken)
    .digest('hex')
    .substring(0, 16);

  return `${apiUrl}:${tokenFingerprint}`;
}

