-- Organization Mirror Database Schema
-- v3.0 双路径架构

-- 删除现有表（如果存在）以重新创建
DROP TABLE IF EXISTS followups CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS cases CASCADE;

-- 案例库表
CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  industry TEXT,
  company_size TEXT,
  company_state TEXT,
  surface_problem TEXT,
  initial_explanation TEXT,
  cognition_source TEXT,
  real_bottleneck TEXT,
  friction_layer TEXT,
  recovery_type TEXT,
  failed_action TEXT,
  effective_action TEXT,
  key_questions JSONB DEFAULT '[]',
  adaptation_experiment TEXT,
  insight_confidence TEXT DEFAULT 'low',
  followup_result JSONB,
  completeness TEXT DEFAULT 'skeleton',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 会话表
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  path TEXT DEFAULT 'unknown',
  stage INTEGER DEFAULT 1,
  stage_turn INTEGER DEFAULT 0,
  total_turns INTEGER DEFAULT 0,
  difficulty TEXT DEFAULT 'L1',
  vague_streak INTEGER DEFAULT 0,
  causal_chain JSONB DEFAULT '[]',
  original_problem TEXT,
  curiosity_triggered BOOLEAN DEFAULT FALSE,
  redefined_problem TEXT,
  user_phrasings JSONB DEFAULT '[]',
  history JSONB DEFAULT '[]',
  discovery_output JSONB,
  session_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 回访记录表
CREATE TABLE followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT REFERENCES sessions(id),
  result TEXT,
  improved BOOLEAN,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_cases_completeness ON cases(completeness);
CREATE INDEX idx_cases_industry ON cases(industry);
CREATE INDEX idx_cases_confidence ON cases(insight_confidence);
CREATE INDEX idx_sessions_path ON sessions(path);
CREATE INDEX idx_sessions_complete ON sessions(session_complete);
CREATE INDEX idx_sessions_created ON sessions(created_at);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cases_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS 策略
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE followups ENABLE ROW LEVEL SECURITY;

-- 允许匿名访问
CREATE POLICY "Allow anonymous read cases" ON cases FOR SELECT USING (true);
CREATE POLICY "Allow anonymous read sessions" ON sessions FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert sessions" ON sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update sessions" ON sessions FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous read followups" ON followups FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert followups" ON followups FOR INSERT WITH CHECK (true);
