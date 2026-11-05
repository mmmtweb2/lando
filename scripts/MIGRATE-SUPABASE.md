# העברת Supabase לפרנקפורט (מדריך למשה)

הפרויקט הישן (טוקיו) **רק נקרא**: הסקריפט פותח אליו חיבור לקריאה בלבד ואינו כותב לתמונות שלו. אפשר לחזור אחורה בכל שלב.

## מה צריך בצד שלך
- Node 18+ במחשב, ובתיקיית הפרויקט: `git pull && npm ci`.
- פרויקט חדש ב-Supabase באזור Frankfurt (נפתח).
- קובץ הגדרות מקומי מתוך `scripts/migrate-supabase.env.example` (מחוץ לריפו). טעינה: `set -a; source ~/supabase-migrate.env; set +a`.

## חזרה על הכל ללא סיכון (חזרה מדומה)
אפשר להריץ את כל השלבים בלי לעצור את האפליקציה. זו צילום-מצב של הנתונים; לא יפגע בכלום. כך מגלים בעיות מראש.

```
node scripts/migrate-supabase.mjs check      # חיבור, ספירות, חוסרים
node scripts/migrate-supabase.mjs schema     # מריץ 001-045 על הפרויקט החדש
node scripts/migrate-supabase.mjs data       # שורות + משתמשי Auth עם הסיסמאות
node scripts/migrate-supabase.mjs storage    # תמונות ולוגואים (אותם נתיבים)
node scripts/migrate-supabase.mjs rewrite    # מחליף את כתובת הפרויקט הישן בחדש בכל הנתונים
node scripts/migrate-supabase.mjs verify     # אימות מלא (כל הבדיקות צריכות להיות PASS)
```
אם משהו נכשל או שרוצים להתחיל מחדש: `CONFIRM_RESET_NEW=<host של NEW_DATABASE_URL> node scripts/migrate-supabase.mjs reset-new` ואז שוב מ-schema. (מוחק רק את הפרויקט **החדש**.)

## ההעברה בפועל (חלון תחזוקה קצר)
1. ב-Coolify: **עצור** את האפליקציה (כך שאין כתיבות חדשות).
2. `reset-new` ואז `schema`, `data`, `storage`, `rewrite`, `verify`. חייב להסתיים ב-"All checks passed".
3. ב-Supabase החדש, **העתק ידנית את הגדרות Auth מהישן** (Authentication): Site URL = `https://pagey.co.il`; Redirect URLs (כולל `https://pagey.co.il/reset-password`); הגדרות SMTP ותבניות מייל; משך טוקן; הרשמה פתוחה/סגורה כמו בישן. בדוק גם Extensions: pgcrypto פעיל.
4. ב-Coolify עדכן משתני סביבה (ערכים מהפרויקט החדש): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, ובנוסף משתני **בנייה** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
5. **Redeploy** (חובה: משתני VITE נאפים בזמן הבנייה).
6. בדיקות עשן: התחברות עם חשבון קיים (הסיסמה נשמרה; כולם יתחברו מחדש כי סשנים לא עוברים), דשבורד נטען, יצירת דף עם תמונה, דף ציבורי עם תמונות ולוגו, איפוס סיסמה (המייל והקישור).

## חזרה לאחור
החזר את משתני הסביבה הישנים ב-Coolify ועשה Redeploy. הפרויקט הישן לא שונה. שמור אותו 7 ימים לפחות, ואז השהה (Pause) אותו.

## מה הסקריפט לא מעביר
סשנים והתחברויות פעילות, הגדרות Auth, מפתחות, כתובות ה-API (לכן שלב 4), ו-Edge Functions (אין כאלה בפרויקט).
