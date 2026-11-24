# תבניות המייל של Supabase Auth, בעברית

QA 24.11: מייל אישור ההרשמה וקישור הכניסה הגיעו בתבנית האנגלית הגנרית של Supabase. כאן ארבע תבניות בעברית, מימין לשמאל, בסגנון של Pagey. Supabase שולח את המיילים האלה בעצמו, ולכן אין להן קוד בשרת: מדביקים אותן בדשבורד של Supabase.

## איפה מדביקים

Supabase Dashboard → הפרויקט של Pagey → **Authentication → Emails** (בגרסאות קודמות: Authentication → Email Templates) → לשונית לכל תבנית. בכל לשונית מחליפים את **Subject** ואת **Message body** (מצב Source), ולוחצים Save.

| לשונית ב-Supabase | קובץ | שורת נושא (Subject) |
|---|---|---|
| Confirm signup | `confirm-signup.html` | `אישור ההרשמה ל-Pagey` |
| Magic Link | `magic-link.html` | `הקישור שלכם לכניסה ל-Pagey` |
| Reset Password | `reset-password.html` | `איפוס הסיסמה שלכם ב-Pagey` |
| Change Email Address | `change-email.html` | `אישור כתובת המייל החדשה ב-Pagey` |

אחרי השמירה: נרשמים עם כתובת בדיקה, מבקשים קישור כניסה ואיפוס סיסמה, ובודקים שכל מייל מגיע בעברית, שהכפתור עובד, ושהקישור חוזר ל-`pagey.co.il`.

## המשתנים בתבניות

- `{{ .ConfirmationURL }}`: הקישור שהלקוח לוחץ עליו. מופיע פעמיים בכל תבנית: בכפתור, וכקישור טקסט מלא למקרה שהכפתור לא נטען (גם בתצוגת טקסט בלבד).
- `{{ .SiteURL }}`: הכתובת שמוגדרת ב-Authentication → URL Configuration → Site URL (צריכה להיות `https://pagey.co.il`). משמש בשורת "נשלח מ-Pagey".
- `{{ .Email }}` ו-`{{ .NewEmail }}`: רק בתבנית החלפת המייל (הכתובת הקיימת והחדשה).
- `{{ .Token }}` (קוד בן 6 ספרות) **לא נכלל בכוונה**: באתר אין כרגע מסך להקלדת קוד (אין קריאה ל-`verifyOtp`), ולקוח שיקבל קוד בלי מקום להקליד אותו רק יתבלבל. אם יתווסף מסך כזה, אפשר להוסיף מתחת לכפתור בתבניות Magic Link ו-Confirm signup:
  `<p style="margin:0 0 12px;font-size:15px;color:#334155;">או הקלידו את הקוד: <b dir="ltr" style="font-size:20px;letter-spacing:3px;">{{ .Token }}</b></p>`
  אותו דבר לתבנית Reauthentication, שנדרשת רק אם מפעילים את "Secure password change" (כרגע לא כדאי להפעיל: האתר לא תומך בשלב האימות הנוסף).

הקישורים חוזרים לכתובות שהאתר מבקש (`emailRedirectTo` / `redirectTo` ב-`client/src/pages/Login.tsx`), ולכן צריך שב-Authentication → URL Configuration → Redirect URLs יופיעו `https://pagey.co.il/**` (כולל `/reset-password` ו-`/start`).

## שולח המיילים (SMTP)

בדקתי את הקוד ואת המסמכים: **אין SMTP מותאם מוגדר למיילים של Supabase Auth**. הקוד שולח רק את המיילים של Pagey עצמה (התראות, תזכורות, פניות) דרך Resend, מהכתובת ב-`RESEND_FROM_EMAIL`. `docs/customer-path.md` כבר מציין ש"לא נבדק מה מוגדר בפרויקט", ו-`scripts/MIGRATE-SUPABASE.md` מזכיר להעתיק הגדרות SMTP בהעברת פרויקט. בלי SMTP מותאם, Supabase שולח מהשולח הכללי שלו, עם מגבלה של כמה מיילים בשעה לכל הפרויקט, ומיילים כאלה נוטים יותר להגיע לספאם.

ההמלצה: לשלוח מכתובת של `pagey.co.il`, דרך Resend שכבר בשימוש:

1. ב-Resend: Domains → להוסיף את `pagey.co.il` ולהגדיר את רשומות ה-DNS שהוא נותן (SPF, DKIM, ומומלץ גם DMARC), עד שהדומיין מאומת.
2. ב-Supabase: Authentication → Emails → **SMTP Settings** → Enable custom SMTP:
   - Sender email: `no-reply@pagey.co.il` (או `hello@pagey.co.il`)
   - Sender name: `Pagey`
   - Host: `smtp.resend.com`, Port: `465`, Username: `resend`, Password: מפתח API של Resend (עדיף מפתח נפרד, עם הרשאת שליחה בלבד)
3. אחרי ההפעלה כדאי להעלות את מגבלת השליחה ב-Authentication → Rate Limits (לפי הצורך).
4. כדאי ש-`RESEND_FROM_EMAIL` בשרת יהיה גם הוא כתובת של `pagey.co.il`, כדי שכל המיילים יגיעו מאותו שולח.

כתובת התמיכה בתחתית התבניות היא `tirnoer.digital@gmail.com`, כמו ב-`src/services/mailFooter.ts`. ה-QA ציין שכתובת Gmail נראית פחות מקצועית. כשתהיה כתובת תמיכה ב-`pagey.co.il`, מחליפים אותה בארבעת הקבצים וב-`mailFooter.ts`.
