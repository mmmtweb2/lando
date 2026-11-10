// Run: npx tsx scripts/test-design-choice.ts
// Pinkas (v3) is the default look for regular pages; ?design=1|2 opt out; child pages keep their look.
import assert from 'node:assert/strict';
import { isDesignV3 } from '../client/src/lib/designChoice';

const root = { parent_id: null };
const child = { parent_id: 'abc' };
assert.equal(isDesignV3(null, root), true, 'default: v3 for a regular page');
assert.equal(isDesignV3(null, {}), true, 'page without parent_id field: v3');
assert.equal(isDesignV3('2', root), false, '?design=2 opts out');
assert.equal(isDesignV3('1', root), false, '?design=1 opts out');
assert.equal(isDesignV3('3', root), true, '?design=3 forces v3');
assert.equal(isDesignV3(null, child), false, 'child (SEO) page keeps its look by default');
assert.equal(isDesignV3('3', child), true, '?design=3 forces v3 on a child page');
assert.equal(isDesignV3(null, null), false, 'page not loaded yet: not v3');
assert.equal(isDesignV3('bogus', root), true, 'unknown value falls back to the default');
console.log('test-design-choice: OK');
