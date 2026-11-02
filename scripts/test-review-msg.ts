// Run: npx tsx scripts/test-review-msg.ts
import assert from 'node:assert/strict';
import { localPhone, requestText, reviewUrl, waLink } from '../client/src/lib/reviewRequestMsg';
assert.equal(localPhone('972501234567'), '0501234567');
const link = reviewUrl('ChIJ abc');
assert.equal(link, 'https://search.google.com/local/writereview?placeid=ChIJ%20abc');
const first = requestText('first', 'דנה', 'קפה נעמי', link);
assert.ok(first.includes('דנה') && first.includes('קפה נעמי') && first.includes(link));
const fu = requestText('followup', 'דנה', 'קפה נעמי', link);
assert.ok(fu.includes('תזכורת') && fu.includes(link) && fu !== first);
const w = waLink('972501234567', first);
assert.ok(w.startsWith('https://wa.me/972501234567?text='));
assert.equal(decodeURIComponent(w.split('?text=')[1]), first);
console.log('review message checks passed');
