-- איפוס חשבון בדיקה של מוצר הקידום (סשן התיקונים 8.11, סעיף 2)
-- מטרה: להחזיר חשבון אחד למצב "לקוח חדש שעוד לא התחיל", בלי למחוק את החשבון עצמו.
-- משה מריץ בעצמו ב-Supabase SQL editor. פועל על אימייל אחד בלבד.
--
-- איך להשתמש:
--   1. מדביקים את כל הקובץ ומריצים (זה רק יוצר פונקציה זמנית ולא משנה כלום).
--   2. בדיקה, לא משנה כלום:   select * from pg_temp.reset_seo_account('המייל@שלך.com', false);
--   3. איפוס בפועל:           select * from pg_temp.reset_seo_account('המייל@שלך.com', true);
--   (מריצים את שורת 2 או 3 בנפרד, באותו חלון, אחרי שורה 1.)
-- התוצאה: טבלה עם שם כל טבלה, כמה שורות נמצאו וכמה נמחקו (בבדיקה: 0).
--
-- מה מתאפס:
--   user_profiles.is_admin ← false (החשבון עצמו, הסיסמה והדפים שלו נשארים)
--   user_products, seo_subscriptions (+ אירועי החיוב שלו), seo_addon_pages, seo_manual_premium,
--   seo_journey + journey_events, seo_businesses (+ ערכות תוכן ושירותים), seo_setup_steps,
--   gbp_connections, seo_feedback, seo_email_prefs, seo_digest_log
-- מה לא נוגע בו: דפי נחיתה שנוצרו (גם דף שנרשם כ"כלול" נשאר, רק הרישום שלו נמחק),
--   קרדיטים ויתרת דפים, לידים, והמנוי עצמו בסאמיט (אם נוצרה הוראת קבע אמיתית, מבטלים אותה
--   ידנית בדשבורד של סאמיט; ראו docs/payment-safety.md).
-- טבלה שלא קיימת (למשל לפני מיגרציה 047) מדולגת ומסומנת "missing".

create or replace function pg_temp.reset_seo_account(p_email text, p_apply boolean)
returns table(table_name text, rows_found bigint, rows_deleted bigint)
language plpgsql as $fn$
declare
  e text := lower(btrim(p_email));
  t record;
  found_n bigint;
  del_n bigint;
begin
  if e is null or e = '' or position('@' in e) = 0 then
    raise exception 'צריך אימייל תקין';
  end if;
  if not exists (select 1 from user_profiles where lower(email) = e) then
    raise exception 'אין חשבון עם האימייל הזה';
  end if;

  -- אדמין
  select count(*) into found_n from user_profiles where lower(email) = e and coalesce(is_admin, false);
  del_n := 0;
  if p_apply then
    update user_profiles set is_admin = false where lower(email) = e and coalesce(is_admin, false);
    get diagnostics del_n = row_count;
  end if;
  table_name := 'user_profiles.is_admin → false'; rows_found := found_n; rows_deleted := del_n; return next;

  -- טבלאות שמסוננות ישירות לפי עמודת אימייל. הסדר חשוב רק לדיווח: כל השאר נמחק במפורש.
  for t in
    select * from (values
      ('seo_addon_pages',     'email'),
      ('seo_subscription_events', null),     -- ראו למטה: לפי מזהה מנוי
      ('seo_subscriptions',   'email'),
      ('user_products',       'email'),
      ('seo_manual_premium',  'email'),
      ('journey_events',      'email'),
      ('seo_journey',         'email'),
      ('seo_setup_steps',     'email'),
      ('gbp_connections',     'email'),
      ('seo_feedback',        'email'),
      ('seo_email_prefs',     'email'),
      ('seo_digest_log',      'email')
    ) as v(tbl, col)
  loop
    table_name := t.tbl; rows_found := 0; rows_deleted := 0;
    if to_regclass('public.' || t.tbl) is null then
      table_name := t.tbl || ' (missing)'; return next; continue;
    end if;
    if t.tbl = 'seo_subscription_events' then
      execute 'select count(*) from seo_subscription_events where subscription_id in (select id from seo_subscriptions where lower(email) = $1)'
        into rows_found using e;
      if p_apply then
        execute 'delete from seo_subscription_events where subscription_id in (select id from seo_subscriptions where lower(email) = $1)' using e;
        get diagnostics rows_deleted = row_count;
      end if;
    else
      execute format('select count(*) from %I where lower(%I) = $1', t.tbl, t.col) into rows_found using e;
      if p_apply then
        execute format('delete from %I where lower(%I) = $1', t.tbl, t.col) using e;
        get diagnostics rows_deleted = row_count;
      end if;
    end if;
    return next;
  end loop;

  -- עסקים שמורים, ועמם (CASCADE) ערכות התוכן והשירותים שלהם
  table_name := 'seo_businesses (+ kits, services)';
  select count(*) into rows_found from seo_businesses where lower(owner_email) = e;
  rows_deleted := 0;
  if p_apply then
    delete from seo_businesses where lower(owner_email) = e;
    get diagnostics rows_deleted = row_count;
  end if;
  return next;
end;
$fn$;
