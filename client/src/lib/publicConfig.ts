// /api/public/config — what the public pages need from the server (read once per page load).

export interface PublicConfig { auditEnabled: boolean; concierge: string | null; consentText: string }

let cached: Promise<PublicConfig | null> | null = null;

export function getPublicConfig(): Promise<PublicConfig | null> {
  if (!cached) {
    cached = fetch('/api/public/config')
      .then(r => (r.ok ? (r.json() as Promise<PublicConfig>) : null))
      .catch(() => null);
  }
  return cached;
}
