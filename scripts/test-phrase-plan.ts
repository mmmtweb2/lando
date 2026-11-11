// Search-phrase pages: which ones a business may have (no doorway pages). Pure, no network.
import assert from 'assert';
import { emptyCard, type TruthCard, type TruthService } from '../src/services/businessTruth';
import { DEFAULT_PAGES, MAX_PAGES, admit, allIdeas, pageCap, phraseOf, similarity, suggest, tooSimilar } from '../src/services/phrasePlan';

const svc = (name: string, description = ''): TruthService => ({ name, description, source: 'google' });
const small: TruthCard = { ...emptyCard(), name: 'אינסטלציה דני', services: [svc('תיקון נזילות', 'איתור ותיקון נזילות בבית ובעסק'), svc('פתיחת סתימות')], areas: ['גבעתיים', 'רמת גן', 'תל אביב'] };
const wide: TruthCard = { ...small, services: [...small.services, svc('התקנת דוד שמש', 'התקנה והחלפה של דודי שמש וחשמל'), svc('החלפת ברזים', 'החלפת ברזים וסוללות כולל אספקה'), svc('איתור נזילות')] };

assert.equal(phraseOf(' תיקון נזילות ', 'רמת גן'), 'תיקון נזילות ברמת גן');
assert.equal(pageCap(small), DEFAULT_PAGES);
assert.equal(pageCap(wide), MAX_PAGES, 'at least 4 services and 2 areas: up to 10');
assert.equal(pageCap({ ...wide, areas: ['גבעתיים'] }), DEFAULT_PAGES, 'many services but one area');

// Ideas: one page per service in the main area first; a second area only for a service with its own description.
assert.deepEqual(allIdeas(small).map((i) => i.phrase), ['תיקון נזילות בגבעתיים', 'פתיחת סתימות בגבעתיים', 'תיקון נזילות ברמת גן']);
assert.ok(!allIdeas(small).some((i) => i.area === 'תל אביב'), 'never a third area: that is the doorway pattern');
assert.deepEqual(allIdeas({ ...small, areas: [], city: 'חולון' }).map((i) => i.area), ['חולון', 'חולון'], 'no service areas: the business\'s own city');
assert.deepEqual(allIdeas({ ...small, areas: [], city: '' }), [], 'no area at all: no pages');
assert.deepEqual(allIdeas({ ...small, services: [] }), []);

// Similarity.
assert.equal(similarity('תיקון נזילות בגבעתיים', 'תיקון נזילה בגבעתיים'), 1, 'singular and plural are the same page');
assert.ok(similarity('תיקון נזילות בגבעתיים', 'תיקון נזילות ברמת גן') < 0.75, 'the same service in another area is a different page');
assert.ok(similarity('תיקון דוד שמש בגבעתיים', 'התקנת דוד שמש בגבעתיים') < 0.75, 'repair and installation are different services');
assert.ok(tooSimilar('בגבעתיים תיקון נזילות', ['תיקון נזילות בגבעתיים']), 'the same words in another order');
assert.equal(similarity('', 'x'), 0);

// Suggestions.
let s = suggest(small, []);
assert.deepEqual([s.cap, s.left, s.ideas.length], [5, 5, 3]);
s = suggest(small, ['תיקון נזילות בגבעתיים']);
assert.deepEqual(s.ideas.map((i) => i.phrase), ['פתיחת סתימות בגבעתיים', 'תיקון נזילות ברמת גן'], 'what already exists is not offered again');
s = suggest(wide, []);
assert.equal(s.ideas.length, 8, '5 services in the main area + 3 described ones in the second');
assert.equal(suggest(wide, s.ideas.map((i) => i.phrase)).ideas.length, 0);
assert.equal(suggest(small, ['a', 'b', 'c', 'd', 'e']).left, 0, 'the cap counts every existing page, whatever its phrase');
const near = suggest({ ...small, services: [svc('תיקון נזילות'), svc('תיקון נזילה')] }, []);
assert.equal(near.ideas.length, 1, 'two services that are the same words give one page');

// Admission.
assert.equal((admit(small, 'תיקון נזילות ברמת גן', []) as { area: string }).area, 'רמת גן');
assert.equal(admit(small, 'אינסטלטור זול בתל אביב', []), 'not_offered', 'only phrases built from the card');
assert.equal(admit(small, 'תיקון נזילות בגבעתיים', ['תיקון נזילות בגבעתיים']), 'exists');
assert.equal(admit(small, 'תיקון נזילות בגבעתיים', ['תיקון נזילה בגבעתיים']), 'too_similar');
assert.equal(admit(small, 'פתיחת סתימות בגבעתיים', ['a', 'b', 'c', 'd', 'e']), 'limit');
assert.ok(typeof admit(wide, 'פתיחת סתימות בגבעתיים', ['a', 'b', 'c', 'd', 'e']) === 'object', 'a wide business has room for more');

console.log('phrase plan: all checks passed');
