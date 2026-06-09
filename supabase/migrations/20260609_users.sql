-- v9 功能1：历史对话侧边栏
-- 新增 users 表 + sessions.user_id + sessions.title

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  session_count INTEGER DEFAULT 0,
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- sessions 表新增字段
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT;

-- 索引
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);

-- RLS 策略 for users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous read users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update users" ON users FOR UPDATE USING (true);
