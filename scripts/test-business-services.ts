process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
import assert from 'assert';
import { MAX_SERVICES, ServicesError, normalizeServices } from '../src/services/businessServices.service';

assert.deepEqual(normalizeServices(['  ניקיון   דירות ', 'ניקיון דירות', 'צביעה', '', '   ']), ['ניקיון דירות', 'צביעה'], 'trim, collapse, dedupe, drop empty');
assert.deepEqual(normalizeServices(['a‮b\nc']), ['a b c'], 'control and bidi characters become spaces');
assert.deepEqual(normalizeServices([]), []);
const bad = (v: unknown) => assert.throws(() => normalizeServices(v), (e: unknown) => e instanceof ServicesError && e.code === 'bad_input');
bad('not a list'); bad([1]); bad(['x'.repeat(41)]); bad(['ראו https://evil.example']); bad(['write@me']); bad(['www.x.co.il']);
bad(Array.from({ length: MAX_SERVICES + 1 }, (_, i) => `שירות ${i}`));
assert.equal(normalizeServices(Array.from({ length: MAX_SERVICES }, (_, i) => `שירות ${i}`)).length, MAX_SERVICES);
console.log('business services checks passed');
