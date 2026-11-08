# מסלול הלקוח בפרודקשן: צעדים, משתני סביבה, מיגרציות (סשן התיקונים 8.11, סעיף 5)

נכתב מהקוד שב-main (לא מהפרודקשן עצמו: מה שמוגדר שם בפועל אני לא רואה). מה שלא בדקתי מסומן "לא נבדק".

## 0. סדר פריסה (פעם אחת, לפני שמשה מתחיל)
1. **מיגרציות, לפני הקוד:** אם 001–045 כבר רצו, מריצים ב-Supabase SQL editor את `migrations/046_seo_plan_catalog.sql` ואז `migrations/047_seo_addon_pages.sql`. 046 לפני 047. שתיהן ניתנות להרצה חוזרת (`IF NOT EXISTS`), אין בהן מחיקה.
   - בדיקת מצב לפני: `select column_name from information_schema.columns where table_name='seo_subscriptions' and column_name in ('plan_id','cycle','with_page','reminder_for_period_end');` (צריך 4 שורות אחרי 046) ו-`select to_regclass('public.seo_addon_pages');` (לא ריק אחרי 047).
   - אם אחרי ההרצה עדיין מתקבל "schema cache" בלוג: `NOTIFY pgrst, 'reload schema';`.
   - אם הקוד נפרס לפני המיגרציה: אין נזק, `POST /api/seo/subscription/start` מחזיר 503 `subscription_not_migrated` והלקוח רואה "המנוי עדיין לא הופעל".
2. **משתני סביבה** (סעיף 1 למטה) ב-Coolify, ואז פריסה מחדש. משתני שרת נקראים בעליית השרת: שינוי דורש restart.
3. **trigger בסאמיט** (אופציונלי למבחן הראשון, מומלץ לפרודקשן): `POST <PUBLIC_API_URL>/api/seo/subscription/webhook?secret=<SEO_SUBSCRIPTION_WEBHOOK_SECRET>`.
4. **איפוס חשבון הבדיקה** (`docs/test-account-reset.sql`, משה מריץ): בלי זה החשבון עלול להיות אדמין או עם הרשאה ידנית, ואז הוא לא ישלם בכלל (ראו צעד 6).
   - **עדכון (#36):** חשבון שמופיע ב-`SEO_TEST_EMAILS` *כן* יכול לשלם גם כשיש לו הרשאה ידנית או אדמין, בלי איפוס. התשלום לא נוגע בהרשאה שלו. חשבון רגיל עם הרשאה עדיין נחסם (409). חשבון הפיתוח של לקוח אמיתי לא נכנס לרשימה ולא מאופס.
5. **אחרי פריסה:** `GET /api/seo/plans` מחזיר `enabled: true` וארבע תוכניות; `/audit` טוען; `/seo-plan` כמשתמש לא מחובר מציע כניסה.

## 1. משתני סביבה
### חובה למסלול הלקוח המלא
| משתנה | ערך | מה קורה אם חסר או שגוי |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | מפרויקט Supabase | השרת לא עובד כלל |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | אותם פרויקט/מפתח ציבורי, **בזמן בניית הלקוח** | הלקוח לא מתחבר. נקבעים ב-build, לא בריצה |
| `PUBLIC_APP_URL` | כתובת האתר, למשל `https://pagey.co.il` | אחרי תשלום הדפדפן חוזר ל-`localhost:5173` (ברירת מחדל) |
| `PUBLIC_API_URL` | כתובת ה-API כפי שהדפדפן והשרתים של סאמיט רואים אותה | כתובות החזרה מסאמיט ומגוגל מצביעות ל-`localhost:3000`: התשלום יצליח והחזרה תיכשל (ראו `payment-safety.md`) |
| `CORS_ORIGIN` | כתובת הלקוח המדויקת | בפרודקשן בלעדיו כל בקשה בין-מקורות נחסמת |
| `GOOGLE_PLACES_API_KEY` | מפתח Places | חיפוש העסק בבדיקה ובהקמה לא מחזיר תוצאות |
| `SEO_SUBSCRIPTION_ENABLED` | `true` | `/seo-plan` מציג "המנוי עדיין לא נפתח" ו-start מחזיר 503 |
| `SUMIT_COMPANY_ID`, `SUMIT_API_KEY` (+ `SUMIT_API_BASE` רק אם שונה מברירת המחדל) | מסאמיט | אותו 503 `disabled` |
| `PAYMENT_GATE_ENABLED` | `true` | **בלעדיו כפתור ההפעלה ב-/start הוא "הפעל (בטא, ללא תשלום)" ולא עובר לתשלום בכלל** |
| `SEO_SUBSCRIPTION_WEBHOOK_SECRET` | מחרוזת אקראית ארוכה | ה-webhook מחזיר 401 לכל בקשה (אין נזק, רק אין ניטור חיוב חידוש) |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | מ-Resend | מיילי המערכת שלנו לא יוצאים (אישור הרשמה יוצא מ-Supabase, לא מכאן) |

### למבחן הראשון בלבד
| משתנה | ערך |
|---|---|
| `SEO_TEST_PRICE` | `1` (סכום חיוב בש"ח; לא חוקי, אפס או מעל 1000 = כבוי) |
| `SEO_TEST_EMAILS` | המייל של משה, מופרד בפסיקים. רק הוא משלם את הסכום הזה |

להסיר את שניהם אחרי הבדיקה ולפרוס מחדש.

### חיבור כרטיס העסק בגוגל (GBP)
`GBP_CONNECT_ENABLED=true`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GBP_TOKEN_ENCRYPTION_KEY` (64 תווי hex, **לא מחליפים אחרי שיש חיבורים**: כולם נשברים), `GBP_CONNECT_ALLOWED_EMAILS` (בזמן שהאפליקציה ב-Testing: המיילים של משתמשי הבדיקה, בדיוק אלה שרשומים כ-test users בגוגל). כתובת ה-redirect שרשומה ב-Google Cloud חייבת להיות זהה תו לתו ל-`<PUBLIC_API_URL>/api/seo/gbp/oauth/callback` (או `GBP_OAUTH_REDIRECT_URI`). אפשר לראות את מצב ההגדרות והאבחון בדף הניהול (האבחון: `gbpDiagnose`). אם מוגדר תחום משותף לעוגיות, `GBP_COOKIE_DOMAIN`.

### אופציונלי, לא חוסם את המסלול
- `ANTHROPIC_API_KEY`: ניסוחי AI (המלצות, תשובות לביקורות). בלעדיו הם נכשלים בנימוס.
- `SUMIT_REQUIRE_BINDING`: **להשאיר לא מוגדר בבדיקה הראשונה.** אם הלוג מראה שסאמיט מחזיר `ExternalIdentifier` בתשלום, להגדיר `true` אחר כך (אז תשלום בלי מזהה נדחה).
- `SERVER_TIMING=true` (זמני, 24 שעות, לאבחון #29), `SLOW_REQUEST_MS`, `SUPABASE_READ_TIMEOUT_MS`.
- `MONTHLY_DIGEST_ENABLED`, `SETUP_REMINDER_ENABLED` (דורשים גם `DIGEST_SECRET`): מיילים אוטומטיים ללקוחות. **לכבות בזמן הבדיקה** כדי שלא יצא מייל אמיתי.
- `ALERTS_ENABLED`, `ALERT_WEBHOOK_URL`, `ADMIN_ALERT_EMAIL`: התראות תפעול.
- `BETA_SELF_ACTIVATION`, `BETA_ACTIVATION_DAYS`: רלוונטיים רק כש-`PAYMENT_GATE_ENABLED` כבוי. עם שער תשלום דלוק הם לא משפיעים.
- `SEO_PLAN_NAME`: השם שהלקוח רואה (ברירת מחדל "קידום העסק בגוגל").
- לא קשורים למסלול: `FAL_KEY`, `UNSPLASH_API_KEY`, `SUPABASE_ASSETS_BUCKET`, `WIDGET_CREDIT_ENABLED`, `AUDIT_*`, `*_CAP`, `ROOT_DOMAIN` ועוד.
- **`SEO_PLAN_PRICE` לא נקרא יותר** (המחירים בקטלוג `src/config/seoCatalog.ts`). הסעיף ב-README שמזכיר אותו מיושן.

## 2. הצעדים של הלקוח, ומה עלול להיתקע
| # | מה הלקוח עושה | מה קורה בשרת | מה עלול להיתקע, ואיך רואים |
|---|---|---|---|
| 1 | נכנס ל-`/audit`, מחפש את העסק, רואה בדיקה | `places/autocomplete`, `places/:id/audit` (דורשים התחברות; הבדיקה הציבורית בנתיב משלה) | אין תוצאות חיפוש: `GOOGLE_PLACES_API_KEY` חסר או שהמכסה נגמרה. תקרות יומיות (`PUBLIC_AUDIT_DAILY_CAP`) חוסמות עומס |
| 2 | נרשם ב-`/login?mode=signup&next=/start` (אימייל וסיסמה) | Supabase שולח מייל אישור; הקישור חוזר ל-`/start`. `POST /api/users/auth` יוצר פרופיל | **מייל האישור לא מגיע** (ספאם, או מגבלת שליחה של Supabase אם אין SMTP מותאם: לא נבדק מה מוגדר בפרויקט). הקישור פג/נוצל: הלקוח מועבר ל-`/login` עם הודעה בעברית. **כתובת האתר לא ברשימת Redirect URLs של Supabase**: הקישור נוחת במקום הלא נכון (לא נבדק) |
| 3 | נטען `/start` | `POST /api/seo/journey/start` (שורה ב-`seo_journey`, אירוע `signup`) | נכשל ברגע ההרשמה כי הפרופיל עוד לא נוצר: מנסה שוב לבד פעם אחת ואז כפתור "נסו שוב". אם מיגרציה 039 חסרה: `not_migrated` |
| 4 | בוחר עסק (או "אין לי כרטיס עסק בגוגל עדיין") | `PUT journey/business` או `journey/profile-pending`; השלב עובר ל-`setup` | place_id לא תקין: `bad_place`. מי שאין לו כרטיס ממשיך בלי place_id, וההפעלה בהמשך עדיין דורשת תשלום |
| 5 | עובר על ההמלצות ולוחץ "סיימתי" | `POST journey/setup-complete` → `ready_to_activate` | `no_business` אם לא נשמר עסק |
| 6 | לוחץ על כפתור ההפעלה | `POST journey/activate`: אם כבר יש הרשאה, מחזיר מיד. אחרת אם `PAYMENT_GATE_ENABLED=true` מחזיר 402 והלקוח עובר ל-`/seo-plan` | **שער תשלום כבוי = בטא חינמית, לא תשלום** (הכפתור כתוב "ללא תשלום"). **חשבון שכבר אדמין או עם הרשאה ידנית** מדלג על התשלום: ב-`/seo-plan` יופיע "המוצר כבר פעיל בחשבון שלכם" ו-start מחזיר 409. לכן מריצים קודם את SQL האיפוס |
| 7 | ב-`/seo-plan` לוחץ "התחלת מנוי ומעבר לתשלום" | `POST /api/seo/subscription/start`: שורה `pending` ב-`seo_subscriptions` (סכום = מחיר קטלוג, או `SEO_TEST_PRICE` לחשבון ברשימה), פתיחת עמוד סליקה בסאמיט | `/seo-plan` ב-main כרגע מציג **תוכנית חודשית אחת** (בורר ארבע התוכניות של קובי, #31, ממתין; עד אז רק `monthly`). 503: `SEO_SUBSCRIPTION_ENABLED` / מפתחות סאמיט / מיגרציה 046 חסרים. 502 "פתיחת התשלום נכשלה": סאמיט דחה את הבקשה (שדות הוראת הקבע לא מאומתים; להסתכל בלוג `[SUBSCRIPTION]`). 409 `already_subscribed` אם כבר פעיל. 429 תקרת קצב |
| 8 | מזין פרטי אשראי **בעמוד של סאמיט** | הדפדפן אצל סאמיט. אנחנו לא רואים ולא שומרים פרטי כרטיס | הוראת קבע לא מופעלת בחשבון סאמיט של Pagey (README: לא אומת): העמוד ייכשל או לא יציע חיוב חוזר. לחיצה על ביטול מחזירה ל-`/dashboard?seo_subscription=cancel`, השורה נשארת `pending` ואפשר לנסות שוב |
| 9 | חוזר מסאמיט | `GET /api/seo/subscription/return`: קריאת התשלום מסאמיט, בדיקת קישור למנוי וסכום מספיק, `active`, מראה ב-`user_products` (source=sumit), אירוע ב-`seo_subscription_events`, אירוע `payment_succeeded`. הדפדפן עובר ל-`/dashboard?seo_subscription=ok` | `seo_subscription=review` ("לא הצלחנו לאשר את התשלום אוטומטית"): ראו `docs/payment-safety.md` סעיף 2. `error`: ה-`ref` לא תקין. `PUBLIC_API_URL`/`PUBLIC_APP_URL` שגויים. הקישור אל הדשבורד אבל המנוי עדיין `pending`: בדקו בלוג "payment not bound" / "below the plan price" |
| 10 | רואה את הדשבורד | `GET /api/seo/businesses` מחבר לבד את העסק מההקמה (`linkJourneyBusiness`); ברירת מחדל דשבורד v2 עד ששינוי קובי (v3 כברירת מחדל) ימוזג | הדשבורד ריק מעסק: ההקמה לא שמרה place_id (צעד 4 דולג). מי שדילג על בחירת עסק ישלם בכל זאת, וצריך לבחור עסק בדשבורד |
| 11 | מחבר את כרטיס העסק בגוגל (GBP) | OAuth, `gbp_connections` עם טוקן מוצפן | המשתמש לא רשום כ-test user (גוגל חוסמת) או לא ב-`GBP_CONNECT_ALLOWED_EMAILS`; טוקן Testing פג אחרי 7 ימים ("צריך להתחבר מחדש"); `redirect_uri_mismatch`; מנהל ולא בעלים: הכרטיס מופיע (PR 87), הדיאגנוזה אומרת אם אין מיקומים; `quota_pending`: גוגל עוד לא אישרה את ה-API לפרויקט, החיבור תקין והנתונים יופיעו אחר כך |
| 12 | עובר את רשימת ההקמה ומתחיל לקדם | `seo_setup_steps`, צעד "חיבור" מזוהה אוטומטית, השאר מסומנים ידנית | אין צעדים שחוסמים את התשלום. כל תקלה כאן היא "אחרי הבדיקה" אלא אם הלקוח לא יכול להמשיך |
| 13 | מבטל מהדשבורד | `POST subscription/cancel` | `needs_manual_cancel` אם הביטול בסאמיט נכשל: `payment-safety.md` סעיף 4 |

## 3. בדיקת קצה לקצה של משה (מומלץ)
1. סעיף 0 במלואו; ב-Coolify `SEO_TEST_PRICE=1`, `SEO_TEST_EMAILS=<מייל משה>`, `PAYMENT_GATE_ENABLED=true`, `SEO_SUBSCRIPTION_ENABLED=true`, כיבוי `MONTHLY_DIGEST_ENABLED` ו-`SETUP_REMINDER_ENABLED`.
2. הרצת SQL האיפוס במצב בדיקה ואז במצב החלה, על חשבון נקי.
3. מדפדפן פרטי: צעדים 1–13 בטבלה. בצעד 7 לוודא ב-DB ש-`amount` הוא 1 לפני שמזינים כרטיס (`select amount, plan_id, status from seo_subscriptions where email='...'`).
4. אחרי החיוב: רשימת הבדיקה בסעיף 6 של `docs/payment-safety.md`.
5. סיום: להסיר `SEO_TEST_PRICE` ו-`SEO_TEST_EMAILS`, לפרוס, ולבטל/להחזיר את חיוב ה-₪1 בסאמיט אם צריך.
