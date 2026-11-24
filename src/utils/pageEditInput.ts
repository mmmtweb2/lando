// Server-side checks for the page editor's save (PATCH /api/landing/:id) and a language's manual edits
// (PATCH /api/landing/:id/translations/:lang). README part 150.
//
// The editor sends the WHOLE ai_content back. Only what CHANGED against the stored page is checked, so a
// page created before these rules (a 15-character phone with letters, a 700-character address) can still
// be saved after fixing a headline. A changed contact field must pass the same rule as in the wizard
// (src/shared/pageInput.ts); any other changed text is only length-bounded.
import { FIELD_LABELS, fieldError, type FieldErrors, type PageInputField } from '../shared/pageInput';

/** The longest single text the editor may store (an about paragraph is ~600 characters). */
export const EDIT_TEXT_MAX = 5000;
/** The whole ai_content, as JSON. Real pages are 5-20 KB. */
export const EDIT_CONTENT_MAX_BYTES = 200 * 1024;

const CONTACT_FIELDS: Record<string, PageInputField> = {
  phone: 'phone_number',
  email: 'email',
  address: 'address',
  business_hours: 'business_hours',
};

export type EditErrors = Record<string, string>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every string in `next` whose value differs from the same path in `prev`, as [path, value]. */
function changedStrings(prev: unknown, next: unknown, path: string, out: Array<[string, string]>, depth = 0): void {
  if (depth > 12) return;
  if (typeof next === 'string') {
    if (next !== prev) out.push([path, next]);
    return;
  }
  if (Array.isArray(next)) {
    const p = Array.isArray(prev) ? prev : [];
    next.forEach((v, i) => changedStrings(p[i], v, path ? `${path}.${i}` : String(i), out, depth + 1));
    return;
  }
  if (isObj(next)) {
    const p = isObj(prev) ? prev : {};
    for (const [k, v] of Object.entries(next)) changedStrings(p[k], v, path ? `${path}.${k}` : k, out, depth + 1);
  }
}

/**
 * Errors keyed by the ai_content path ("contact.phone", "hero.title"), empty when the save may go ahead.
 * `prev` is the stored ai_content (anything, even null, for a page with none).
 */
export function validateContentEdit(prev: unknown, next: unknown): EditErrors {
  if (!isObj(next)) return { ai_content: 'בקשה לא תקינה.' };
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(next), 'utf8'); } catch { return { ai_content: 'בקשה לא תקינה.' }; }
  if (size > EDIT_CONTENT_MAX_BYTES) return { ai_content: 'הדף גדול מדי לשמירה.' };

  const errors: EditErrors = {};
  const changed: Array<[string, string]> = [];
  changedStrings(prev, next, '', changed);
  for (const [path, value] of changed) {
    const m = path.match(/^contact\.(phone|email|address|business_hours)$/);
    if (m) {
      // An emptied contact field is allowed: the page then falls back to the page's own column.
      const e = fieldError(CONTACT_FIELDS[m[1]], value);
      if (e) errors[path] = e;
      continue;
    }
    if (value.length > EDIT_TEXT_MAX) errors[path] = `אפשר עד ${EDIT_TEXT_MAX} תווים בשדה אחד.`;
  }
  return errors;
}

/** A language's manual edits: { key: text }. Only the length is bounded (the keys are checked by the service). */
export function validateTranslationChanges(changes: Record<string, unknown>): EditErrors {
  const errors: EditErrors = {};
  for (const [k, v] of Object.entries(changes)) {
    if (typeof v === 'string' && v.length > EDIT_TEXT_MAX) errors[k] = `אפשר עד ${EDIT_TEXT_MAX} תווים בשדה אחד.`;
  }
  return errors;
}

/** The 400 body both edit endpoints answer with. */
export const editErrorBody = (errors: EditErrors) => ({
  error: Object.values(errors)[0] ?? 'בקשה לא תקינה.',
  code: 'bad_input',
  field_errors: errors,
});

/** The 400 body of page creation: the first problem as `error` (for old clients), every field in field_errors. */
export function inputErrorBody(errors: FieldErrors) {
  const [field, message] = (Object.entries(errors)[0] ?? []) as [PageInputField | undefined, string | undefined];
  return {
    error: field && message ? `${FIELD_LABELS[field]}: ${message}` : 'בקשה לא תקינה.',
    code: 'bad_input',
    field_errors: errors,
  };
}
