// Account-level clean-up of the Google Business Profile connection (used by account deletion).
// A stored refresh token is a standing grant to read the customer's Business Profile: it must
// not outlive the account, neither at Google (revoke) nor in our database (delete the row).

import { gbpOAuthConfig } from '../config/gbp';
import { decryptToken } from './gbpCrypto';
import { revokeToken } from './gbpGoogle';
import { GbpStoreError, deleteConnection, getConnection } from './gbpStore';

/**
 * Revokes the customer's Google token (best effort — a Google outage must not block deleting an
 * account) and then deletes the gbp_connections row. Resolves when no connection remains.
 * Throws only when the row exists but cannot be deleted, so the caller can stop BEFORE it deletes
 * anything else and let the customer retry. A database without migration 033 counts as "no
 * connection".
 */
export async function revokeAndDeleteGbpConnection(email: string): Promise<void> {
  try {
    const c = await getConnection(email);
    if (!c) return;
    const cfg = gbpOAuthConfig();
    if (cfg) {
      const token = decryptToken(c.refresh_token_enc, cfg.key);
      if (token) await revokeToken(token);
    }
    await deleteConnection(email);
  } catch (e) {
    if (e instanceof GbpStoreError && e.code === 'not_migrated') return;
    throw e;
  }
}
