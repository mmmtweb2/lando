# תשלום אמיתי: בטיחות ותפעול (סשן התיקונים 8.11, סעיף 4)

כתוב בשביל מי שמתפעל את התשלום (משה, אבי). מבוסס על הקוד ב-`seoSubscription.service.ts`, `seoSubscription.controller.ts`, `sumitRecurring.ts`.

## 1. מה מאומת ומה לא
**לא מאומת מול סאמיט עד חיוב אמיתי** (מסומן כך גם בקוד):
- שדות הוראת הקבע החודשית בבקשת הסליקה: `Duration_Months` (ברמת הפריט וברמת השורה).
- שאנחנו קוראים נכון את `CustomerID` ואת `RecurringCustomerItemIDs[0]` שחוזרים מסאמיט. אם לא, המנוי יופעל אבל לא יישמר מזהה הוראת הקבע, ולכן **ביטול אוטומטי לא יעבוד** (סעיף 4 למטה).
- שה-trigger של סאמיט (webhook) שולח `ExternalIdentifier` ו-`OG-PaymentID` במבנה שאנחנו מזהים.
- שבמנוי שנתי `MaximumPayments: 12` אכן מציע פריסה בעמוד הסליקה, ושהסכום שמאומת בפריסה הוא הסכום הכולל.

**מאומת בבדיקות שלנו (אבל על סאמיט מדומה):** אימות כל תשלום מול סאמיט לפני הפעלה, קישור התשלום למנוי (`ExternalIdentifier`), סכום מספיק, הגנה מפני תשלום חוזר (`sumit_payment_id` ייחודי).

**לכן החיוב הראשון הוא ₪1 דרך מצב בדיקה** (`SEO_TEST_PRICE=1`, `SEO_TEST_EMAILS=<המייל של משה>`), ואחריו בודקים את הרשימה בסעיף 6.

## 2. חיוב הצליח בסאמיט, אבל החזרה אלינו נכשלה (תשלום ראשון)
מה קורה: הלקוח שילם, הדפדפן נסגר או שהחזרה נכשלה. השורה ב-`seo_subscriptions` נשארת `pending` ואין לה אירוע.

**איך מזהים:**
```sql
-- מנויים שנתקעו בהמתנה יותר מרבע שעה
select id, email, plan_id, amount, created_at, updated_at
from seo_subscriptions
where status = 'pending' and updated_at < now() - interval '15 minutes'
order by created_at desc;
```
ובסאמיט: תשלום בסכום הזה על הלקוח הזה שאין לו אירוע ב-`seo_subscription_events` (סעיף 5).

**איך מתקנים (בלי קוד, בטוח לחזור עליו):** פותחים בדפדפן
`<PUBLIC_API_URL>/api/seo/subscription/return?ref=<id מהשאילתה>&OG-PaymentID=<מספר התשלום בסאמיט>`
הכתובת **לא דורשת התחברות ולא סומכת על מי שפתח אותה**: השרת קורא את התשלום מסאמיט, בודק שהוא שייך למנוי הזה ושהסכום מספיק, ורק אז מפעיל. הדפדפן יועבר לדשבורד. פעם שנייה עם אותו תשלום מחזירה "duplicate" ולא משנה כלום. אם התשלום לא שייך למנוי או לא מספיק, השורה נשארת `pending` ובלוג יופיע הנימוק.

**מניעה:** להגדיר ב-סאמיט trigger על תשלום חדש לכתובת `<PUBLIC_API_URL>/api/seo/subscription/webhook?secret=<SEO_SUBSCRIPTION_WEBHOOK_SECRET>`. אז גם בלי חזרת הדפדפן התשלום ייקלט. (עדיין לא מאומת שהוא שולח את השדות שאנחנו מצפים להם.)

## 3. חיוב חודשי הצליח בסאמיט אבל לא נקלט אצלנו (חידוש)
חשוב כי **בלי קליטה המנוי עובר ל-`past_due` בסוף התקופה, ואחרי 7 ימים ל-`canceled`**, והלקוח מאבד גישה (ודף כלול מוקפא) למרות ששילם. אותו תיקון כמו בסעיף 2 (כתובת ה-`return` עם `ref` של המנוי ומספר התשלום של החידוש) מאריך את התקופה בחודש. מי שנמצא ב-`past_due`:
```sql
select id, email, plan_id, amount, current_period_end, sumit_recurring_item_id
from seo_subscriptions where status = 'past_due' order by current_period_end;
```
לכל שורה לבדוק בסאמיט אם יש חיוב מוצלח אחרי `current_period_end`. אם כן, להריץ את כתובת התיקון.

## 4. ביטול ידני של הוראת קבע בסאמיט
מתי נדרש: `needs_manual_cancel = true` (הלקוח ביטל אצלנו וקריאת הביטול לסאמיט נכשלה), או שלא נשמר מזהה הוראת קבע.
```sql
-- חשבונות שצריך לטפל בהם ידנית, עם המזהים לחיפוש בסאמיט
select email, status, sumit_customer_id, sumit_recurring_item_id, current_period_end
from seo_subscriptions where needs_manual_cancel = true;
```
1. בדשבורד של סאמיט: כרטיס הלקוח (לפי המייל או `sumit_customer_id`) ← הוראות הקבע שלו ← ביטול. **שמות התפריטים לא אומתו על ידי; אם אין, פנו לתמיכת סאמיט עם `sumit_customer_id` ו-`sumit_recurring_item_id`.**
2. אחרי הביטול: `update seo_subscriptions set needs_manual_cancel = false where email = '<מייל>';`
3. אם `sumit_recurring_item_id` ריק למרות שיש הוראת קבע אצלם (שדות לא מאומתים, סעיף 1), מחפשים בסאמיט לפי המייל.

הלקוח לא יחויב מעבר לתקופה ששילם אם הביטול אצלנו נרשם (`cancel_at_period_end`), אבל **רק ביטול בסאמיט עוצר את החיוב עצמו**.

מנוי שנתי: אין הוראת קבע, לכן אין מה לבטל בסאמיט.

## 5. איפה רואים חיוב שלא נקלט
- **טבלת האירועים:** כל תשלום שנקלט (או נכשל, או בוטל) נרשם ב-`seo_subscription_events`, והמפתח הייחודי הוא מספר התשלום בסאמיט:
```sql
select s.email, e.kind, e.sumit_payment_id, e.amount, e.created_at
from seo_subscription_events e join seo_subscriptions s on s.id = e.subscription_id
order by e.created_at desc limit 50;
```
השוואה לרשימת התשלומים בסאמיט: תשלום שמופיע שם ואין לו שורה כאן = לא נקלט.
- **היומן בקולייפיי** (חיפוש לפי הטקסט):
  - `payment not bound to this subscription — refusing`: תשלום תקין שלא שייך למנוי הזה (שדה `ExternalIdentifier` חסר או שונה).
  - `payment valid but below the plan price — not activating`: שולם פחות מהמחיר.
  - `payment on a canceled subscription — needs a human (refund?)`: שולם על מנוי שבוטל; דורש החזר ידני.
  - `MANUAL ACTION: cancel the standing order in the SUMIT dashboard`: סעיף 4.
- **בריאות באדמין:** סופר חיובים שנכשלו ב-7 ימים, ומנויים שדורשים טיפול (`past_due` או `needs_manual_cancel`), ופעימת ה-webhook של סאמיט. אין שם עדיין תצוגה של `pending` תקוע: זה השאילתה בסעיף 2.

## 6. אחרי חיוב הבדיקה של ₪1, לבדוק
1. שורת `seo_subscriptions` של החשבון `active`, `current_period_end` נכון (חודש, או 12 חודשים בשנתי).
2. `sumit_customer_id` ו-`sumit_recurring_item_id` **לא ריקים** (בחודשי). אם ריקים: שמות השדות שגויים, וביטול אוטומטי לא יעבוד. לשלוח לי את גוף ההחזרה/ה-trigger (בלי פרטי אשראי) לתיקון.
3. אירוע אחד ב-`seo_subscription_events` עם מספר התשלום.
4. ביטול מהדשבורד: `cancel_at_period_end = true`, `needs_manual_cancel = false`, והוראת הקבע בסאמיט אכן בוטלה.
5. פעם שנייה אותה כתובת `return`: "duplicate", בלי שינוי בתאריך.
6. בשנתי: בעמוד הסליקה מוצעת פריסה לתשלומים, והסכום ב-`amount` הוא הכולל.
7. לסיים: להסיר `SEO_TEST_PRICE` ו-`SEO_TEST_EMAILS`, לפרוס מחדש, ולהריץ את SQL האיפוס (`docs/test-account-reset.sql`) אם רוצים להתחיל שוב כלקוח חדש.

## 7. מה לא אוטומטי
- **החזרים:** אין החזר אוטומטי. תשלום כפול (שני תשלומי חידוש שונים באותו חודש, או שנתי ששולם פעמיים) מאריך את התקופה פעמיים, ומחזירים כסף ידנית בסאמיט אם זה לא רצוי.
- **מנוי שנתי שבוטל:** ללא החזר על חודשים שנותרו, כפי שהוחלט.
