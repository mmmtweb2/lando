// The short setup's last screen ("זהו. מכאן אנחנו עובדים") is shown right after the approval and stays
// until the customer presses "לבית". Remembered per account in this browser, so a reload does not
// lose it. Storage may be missing or blocked (private mode): then the screen simply shows once.

const KEY = 'pagey_setup_finish:';

export function readFinish(email: string): boolean {
  try { return window.localStorage.getItem(KEY + email) === '1'; } catch { return false; }
}
export function writeFinish(email: string): void {
  try { window.localStorage.setItem(KEY + email, '1'); } catch { /* not remembered */ }
}
export function clearFinish(email: string): void {
  try { window.localStorage.removeItem(KEY + email); } catch { /* nothing to forget */ }
}
