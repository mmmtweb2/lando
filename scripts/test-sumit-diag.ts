import assert from 'node:assert/strict';
import { diagEnabled, keysOf, shapeOf } from '../src/services/sumitDiag';
import { recurringExperiments } from '../src/services/sumitRecurring';

// shapeOf: key paths and types; values only for the allow-list; nothing identifying leaks
const shape = shapeOf({
  Payment: { ID: 987654, ValidPayment: true, Amount: 1, Status: '000', CustomerID: 55512, Name: 'Moshe Cohen', EmailAddress: 'a@b.co', Phone: '0501234567' },
  RecurringCustomerItemIDs: [444, 445],
  Items: [{ Duration_Months: 1, Description: 'secret text' }],
  Missing: null,
});
const text = shape.join('\n');
assert.ok(shape.includes('Payment.ValidPayment:boolean=true'));
assert.ok(shape.includes('Payment.Amount:number=1'));
assert.ok(shape.includes('Payment.Status:string=000'));
assert.ok(shape.includes('Items[0].Duration_Months:number=1'));
assert.ok(shape.includes('RecurringCustomerItemIDs:array(2)'), 'arrays show their length');
assert.ok(shape.includes('RecurringCustomerItemIDs[0]:number'), 'the id is shown as present, without its value');
assert.ok(shape.includes('Missing:null'));
for (const leak of ['Moshe', 'a@b.co', '0501234567', '987654', '55512', '444', 'secret text']) assert.ok(!text.includes(leak), `no leak: ${leak}`);

// keysOf: names only
assert.deepEqual(keysOf({ 'OG-PaymentID': '123', 'OG-CustomerID': '9' }), ['OG-PaymentID', 'OG-CustomerID']);

// off unless explicitly true
assert.equal(diagEnabled({} as any), false); assert.equal(diagEnabled({ SUMIT_DIAG: 'yes' } as any), false);
assert.equal(diagEnabled({ SUMIT_DIAG: ' TRUE ' } as any), true);

// experiments: off by default, only positive integers
assert.deepEqual(recurringExperiments({} as any), { recurrence: undefined, itemId: undefined });
for (const bad of ['0', '-1', '1.5', 'abc', '', '99999']) assert.equal(recurringExperiments({ SUMIT_RECURRENCE: bad } as any).recurrence, undefined, `bad recurrence ${bad}`);
assert.deepEqual(recurringExperiments({ SUMIT_RECURRENCE: '12', SUMIT_RECURRING_ITEM_ID: '345' } as any), { recurrence: 12, itemId: 345 });

console.log('sumit diag checks passed');
