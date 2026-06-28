-- Migration: 004_add_design_style
-- Description: Add design_style column for user-selected visual style preference

ALTER TABLE landing_pages
  ADD COLUMN IF NOT EXISTS design_style VARCHAR
  CHECK (design_style IS NULL OR design_style IN ('luxury', 'vibrant', 'minimal', 'warm'));
