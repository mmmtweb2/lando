import type { Autopilot } from './useAutopilot';

// Which home an account gets from the automatic product. Pure: no React, no network.

/** Nothing of the automatic product is shown on an account where the feature is not open yet. */
export function autoAvailable(auto: Autopilot): boolean {
  if (auto.notReady) return false;
  if (auto.truth.status === 'ok' && auto.truth.data === null && auto.gbp !== null && !auto.gbp.enabled) return false;
  return true;
}

export const isApproved = (auto: Autopilot) => auto.truth.status === 'ok' && !!auto.truth.data?.approvedAt;

/** The old home (feature closed), a skeleton, the first step alone, or the automatic home. */
export type HomeMode = 'legacy' | 'loading' | 'pending' | 'approved';
export function homeMode(auto: Autopilot): HomeMode {
  if (!autoAvailable(auto)) return 'legacy';
  if (auto.truth.status === 'loading') return 'loading';
  return isApproved(auto) ? 'approved' : 'pending';
}
