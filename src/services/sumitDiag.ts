// Diagnostics for the SUMIT standing-order flow (task #39). SUMIT's recurring field names are unverified,
// and the first real charge created no standing order. With SUMIT_DIAG=true the server logs ONE line per stage
// showing the SHAPE of what was sent/received: key paths and value types, never names, emails, phones or ids.
// Values are shown only for a short allow-list of non-identifying keys (amounts, flags, durations, status codes).
// Off by default; turn it on for the test charge, copy the [SUMIT-DIAG] lines, turn it off.

export function diagEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SUMIT_DIAG ?? '').trim().toLowerCase() === 'true';
}

const SHOW_VALUE = /^(amount|validpayment|status|duration_months|durationmonths|recurrence|currency|maximumpayments|numberofpayments|payments|vatincluded|quantity|unitprice|language|documenttype)$/i;

/** "Items[0].Duration_Months:number=1" style lines. Arrays show their first element only, plus the length. */
export function shapeOf(value: unknown, maxPaths = 80): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length >= maxPaths) return;
    if (v === null || v === undefined) { out.push(`${path}:null`); return; }
    if (Array.isArray(v)) {
      out.push(`${path}:array(${v.length})`);
      if (v.length) walk(v[0], `${path}[0]`, depth + 1);
      return;
    }
    if (typeof v === 'object') {
      if (depth > 4) { out.push(`${path}:object…`); return; }
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k, depth + 1);
      return;
    }
    const key = path.split('.').pop()!.replace(/\[\d+\]$/, '');
    const show = SHOW_VALUE.test(key) && (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 20));
    out.push(`${path}:${typeof v}${show ? '=' + String(v) : ''}`);
  };
  walk(value, '', 0);
  return out.map(s => s.replace(/^\./, ''));
}

/** Names of the keys of a flat bag (a query string): names only, never values. */
export function keysOf(bag: Record<string, unknown>): string[] {
  return Object.keys(bag).slice(0, 40);
}

export function diagLog(stage: string, payload: unknown): void {
  if (!diagEnabled()) return;
  console.warn(`[SUMIT-DIAG] ${stage} ${JSON.stringify(payload)}`);
}
