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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

-- 唯一约束：一个用户一个模块只允许一行（应用层 upsert 依赖 onConflict: 'user_id,module'）
-- 注意：现网加约束前先核查并去重重复行，见交接文档 / 变更 fix-p0-data-safety 组 9
ALTER TABLE workspace_data ADD CONSTRAINT workspace_data_user_module_unique UNIQUE (user_id, module);

-- 3. RLS 安全策略
ALTER TABLE workspace_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_profile" ON profiles FOR ALL USING (auth.uid() = id);
CREATE POLICY "own_data" ON workspace_data FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. 开启 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE workspace_data;

-- 5. Storage photos bucket 的 RLS 策略（限制到 bucket 内本人目录）
-- 图片路径格式：{user_id}/{timestamp}_{random}.jpg
CREATE POLICY "photos_owner_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'photos' AND auth.uid()::text = (storage.folder(name))[1])
  WITH CHECK (bucket_id = 'photos' AND auth.uid()::text = (storage.folder(name))[1]);

-- 6. 关闭公开注册
-- 在 Supabase → Authentication → Sign In / Providers 里关闭 "Allow new users to sign up"
-- 关闭后如需新增用户：Authentication → Users → Add user 手动创建
