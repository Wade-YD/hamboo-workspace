-- ====== Supabase 建表 SQL ======
-- 在 Supabase 控制台 → SQL Editor 里执行

-- 1. 用户档案表
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 新用户自动创建 profile
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. 工作台数据表
CREATE TABLE workspace_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ws_user ON workspace_data(user_id);
CREATE INDEX idx_ws_module ON workspace_data(module);

-- 3. RLS 安全策略
ALTER TABLE workspace_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_profile" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_data" ON workspace_data FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. 开启 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE workspace_data;

-- 5. 关闭公开注册
-- 在 Supabase → Authentication → Settings 里取消勾选 Enable Sign Up
