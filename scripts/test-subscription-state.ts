process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake'; process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import {
  addOneMonth, applyCancel, applyChargeFailed, applyChargeOk, expire, sameState, toEntitlementRow, SubState,
} from '../src/services/subscriptionState';

const d = (s: string) => new Date(s);
const DAY = 86400000;

// addOneMonth: month ends and leap years
assert.equal(addOneMonth(d('2026-01-31T10:00:00Z')).toISOString(), '2026-02-28T10:00:00.000Z');
assert.equal(addOneMonth(d('2028-01-31T10:00:00Z')).toISOString(), '2028-02-29T10:00:00.000Z');
assert.equal(addOneMonth(d('2026-12-15T10:00:00Z')).toISOString(), '2027-01-15T10:00:00.000Z');
assert.equal(addOneMonth(d('2026-03-31T00:00:00Z')).toISOString(), '2026-04-30T00:00:00.000Z');

const now = d('2026-11-01T12:00:00Z');
const pending: SubState = { status: 'pending', currentPeriodEnd: null, cancelAtPeriodEnd: false };

// first charge activates, period = now + 1 month
let r = applyChargeOk(pending, now);
assert.equal(r.state.status, 'active');
assert.equal(r.state.currentPeriodEnd!.toISOString(), '2026-12-01T12:00:00.000Z');

// early renewal extends from the existing end (no lost days)
const active: SubState = r.state;
r = applyChargeOk(active, d('2026-11-28T00:00:00Z'));
assert.equal(r.state.currentPeriodEnd!.toISOString(), '2027-01-01T12:00:00.000Z');

// late renewal (period already ended) extends from "now" (no free days)
r = applyChargeOk({ ...active, status: 'past_due' }, d('2026-12-05T00:00:00Z'));
assert.equal(r.state.status, 'active');
assert.equal(r.state.currentPeriodEnd!.toISOString(), '2027-01-05T00:00:00.000Z');

// a late payment on a canceled subscription is ignored
const canceled: SubState = { status: 'canceled', currentPeriodEnd: d('2026-10-01T00:00:00Z'), cancelAtPeriodEnd: false };
r = applyChargeOk(canceled, now);
assert.equal(r.ignored, true);
assert.equal(r.state, canceled);

// a successful charge clears a pending cancellation (it can only be a new subscription)
r = applyChargeOk({ ...active, cancelAtPeriodEnd: true }, now);
assert.equal(r.state.cancelAtPeriodEnd, false);

// failures: active -> past_due; pending stays pending; canceled stays canceled
assert.equal(applyChargeFailed(active).status, 'past_due');
assert.equal(applyChargeFailed(pending).status, 'pending');
assert.equal(applyChargeFailed(canceled).status, 'canceled');

// cancel: pending -> canceled at once; paid period -> flag only; expired period -> canceled at once
assert.equal(applyCancel(pending, now).status, 'canceled');
const c1 = applyCancel(active, now);
assert.equal(c1.status, 'active');
assert.equal(c1.cancelAtPeriodEnd, true);
assert.equal(applyCancel({ ...active, currentPeriodEnd: d('2026-10-01T00:00:00Z') }, now).status, 'canceled');
assert.equal(applyCancel(canceled, now), canceled);

// expire: nothing before the end
assert.ok(sameState(expire(active, d('2026-11-30T00:00:00Z')), active));
// cancel flag + end passed -> canceled
const flagged: SubState = { ...active, cancelAtPeriodEnd: true };
assert.equal(expire(flagged, d('2026-12-02T00:00:00Z')).status, 'canceled');
// active + end passed, no renewal arrived -> past_due, then canceled after the 7-day grace
const p = expire(active, d('2026-12-02T00:00:00Z'));
assert.equal(p.status, 'past_due');
assert.equal(expire(p, d('2026-12-02T00:00:00Z') ).status, 'past_due');
const endMs = active.currentPeriodEnd!.getTime();
assert.equal(expire(p, new Date(endMs + 6 * DAY)).status, 'past_due');
assert.equal(expire(p, new Date(endMs + 7 * DAY)).status, 'canceled');
// pending and canceled never move
assert.equal(expire(pending, now), pending);
assert.equal(expire(canceled, now), canceled);

// entitlement mirror
assert.equal(toEntitlementRow(pending), null);
assert.deepEqual(toEntitlementRow(active), { status: 'active', current_period_end: '2026-12-01T12:00:00.000Z' });
assert.equal(toEntitlementRow(canceled)!.status, 'canceled');

console.log('subscription state checks passed');
