-- 057: a start date for discount codes (README part 151).
--
--   coupons.starts_at  the code works only from this moment. NULL = from creation (every existing coupon).
--
-- Before this runs the code does not break: no coupon has a start date, checkCoupon never answers
-- "not_started", and creating a coupon WITH a start date in the admin panel answers "דורש את מיגרציה 057".
-- Security: RLS on coupons is already ENABLE + FORCE with zero policies (014); nothing changes.
-- Safe to re-run; no rows are changed or deleted.

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS starts_at timestamptz;

NOTIFY pgrst, 'reload schema';
