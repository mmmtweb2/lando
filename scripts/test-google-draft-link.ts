// Run: npx tsx scripts/test-google-draft-link.ts   (imports client ES modules)
import assert from 'node:assert/strict';
import { googleDraftPath, showGoogleDraft } from '../client/src/dashboard/googleDraft';
import type { OverviewInput } from '../client/src/dashboard/journey';

const base: OverviewInput = { loaded: true, businessName: 'x', hasBusiness: true, contentCount: 0, monthLeads: 0, subscriptionStatus: null, ticks: [], placeId: 'ChIJabc', businessId: 'b1', landingLinked: false };

// shown: connected business, Google card, no page linked
assert.equal(showGoogleDraft(base), true);
// hidden: page already linked, or the state is unknown
assert.equal(showGoogleDraft({ ...base, landingLinked: true }), false);
assert.equal(showGoogleDraft({ ...base, landingLinked: undefined }), false);
// hidden: no Google card, no business
assert.equal(showGoogleDraft({ ...base, placeId: null }), false);
assert.equal(showGoogleDraft({ ...base, placeId: undefined }), false);
assert.equal(showGoogleDraft({ ...base, businessId: null }), false);
assert.equal(showGoogleDraft({ ...base, hasBusiness: false, businessId: null, placeId: null }), false);

// exact path the wizard expects, id escaped
assert.equal(googleDraftPath('abc-123'), '/create?from=google&business=abc-123');
assert.equal(googleDraftPath('a b&c'), '/create?from=google&business=a%20b%26c');
console.log('test-google-draft-link: ok');
