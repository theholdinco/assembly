ALTER TABLE clo_profiles
  ADD COLUMN IF NOT EXISTS equity_inception_data JSONB DEFAULT NULL;
