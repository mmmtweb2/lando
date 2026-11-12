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

// The short setup of the automatic product (ShortSetup.tsx): connect, approve, "from here we work".
export type SetupStep = 1 | 2 | 3;

/** Which step the account is on. `finished` = the details were approved while this setup was open. */
export function setupStep(auto: Autopilot, finished: boolean): SetupStep {
  if (finished) return 3;
  const { truth, gbp } = auto;
  const connected = !!gbp && gbp.connected && !gbp.needsReconnect;
  // Details that were already read can be approved even while the connection needs renewing.
  if (truth.status === 'ok' && truth.data === null && !connected) return 1;
  return 2;
}
