// The standing order through SUMIT's recurring API: the request we send and how we read the answer.
// No network. The field names are UNVERIFIED against live SUMIT; this guards OUR side of the contract.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'assert';
import { createStandingOrder, readStandingOrder, standingOrderAfterPayment, standingOrderBody, sumitDate } from '../src/services/sumitRecurring';

const NOW = new Date('2026-11-12T10:00:00Z');
const NEXT = new Date('2026-12-12T10:00:00Z');
const p = { customerId: '12345', itemName: 'קידום העסק בגוגל – מנוי חודשי', amount: 250, firstCharge: NEXT };

(async () => {
  // The switch: off unless set exactly.
  assert.equal(standingOrderAfterPayment({} as NodeJS.ProcessEnv), false);
  assert.equal(standingOrderAfterPayment({ SUMIT_STANDING_ORDER: 'true' } as NodeJS.ProcessEnv), false);
  assert.equal(standingOrderAfterPayment({ SUMIT_STANDING_ORDER: 'after_payment' } as NodeJS.ProcessEnv), true);

  assert.equal(sumitDate(NEXT), '2026-12-12');
  assert.equal(sumitDate(new Date('2026-12-12T22:30:00Z')), '2026-12-13', 'the date is Israel\'s, not UTC\'s');

  // The request.
  const b = standingOrderBody(p, NOW) as any;
  assert.deepEqual(b.Customer, { ID: 12345, SearchMode: 1 }, 'exactly this customer: never a search that could match or create another');
  assert.equal(b.Items.length, 1);
  assert.deepEqual([b.Items[0].UnitPrice, b.Items[0].Quantity, b.Items[0].Duration_Months, b.Items[0].Item.Duration_Months, b.Items[0].Recurrence], [250, 1, 1, 1, 0]);
  assert.equal(b.Items[0].Date_Start, '2026-12-12', 'the first charge is a period after the month that was just paid');
  assert.equal(b.VATIncluded, true);
  assert.ok(!('SingleUseToken' in b) && !('PaymentMethod' in b), 'no card data ever passes through us');
  for (const bad of [{ ...p, customerId: '' }, { ...p, customerId: 'abc' }, { ...p, customerId: '-4' }, { ...p, amount: 0 }, { ...p, amount: NaN }, { ...p, firstCharge: NOW }, { ...p, firstCharge: new Date('2026-11-01T00:00:00Z') }]) {
    assert.throws(() => standingOrderBody(bad, NOW), /standing order/, 'a request that could create a wrong order is never sent');
  }

  // The answer.
  assert.deepEqual(readStandingOrder({ Status: 0, Data: { RecurringCustomerItemIDs: [777] } }), { ok: true, recurringItemId: '777', chargedNow: null, error: null });
  assert.equal(readStandingOrder({ Status: 0, Data: { Payment: { RecurringCustomerItemIDs: [778] } } }).recurringItemId, '778', 'the ids may sit inside Payment');
  const charged = readStandingOrder({ Status: 0, Data: { RecurringCustomerItemIDs: [9], Payment: { ID: 55, ValidPayment: true, Amount: 250 } } });
  assert.deepEqual(charged.chargedNow, { paymentId: '55', amount: 250 }, 'SUMIT charged at once: reported, so a double charge is noticed');
  assert.equal(readStandingOrder({ Status: 0, Data: {} }).ok, false, 'success without an id is not a standing order');
  const refused = readStandingOrder({ Status: 1, UserErrorMessage: 'אין אמצעי תשלום שמור' });
  assert.deepEqual([refused.ok, refused.error], [false, 'אין אמצעי תשלום שמור']);

  // The call.
  const calls: Array<{ path: string; body: any }> = [];
  const ok = await createStandingOrder(p, NOW, (async (path: string, body: any) => { calls.push({ path, body }); return { Status: 0, Data: { RecurringCustomerItemIDs: [777] } }; }) as never);
  assert.equal(ok.recurringItemId, '777');
  assert.equal(calls[0].path, '/billing/recurring/charge/');
  const down = await createStandingOrder(p, NOW, (async () => { throw new Error('network'); }) as never);
  assert.deepEqual([down.ok, down.error], [false, 'network'], 'a failure never throws: the customer already has the month they paid for');
  calls.length = 0;
  const invalid = await createStandingOrder({ ...p, customerId: 'x' }, NOW, (async (path: string, body: any) => { calls.push({ path, body }); return { Status: 0, Data: {} }; }) as never);
  assert.deepEqual([invalid.ok, calls.length], [false, 0], 'a bad request is not sent at all');

  console.log('standing order: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
