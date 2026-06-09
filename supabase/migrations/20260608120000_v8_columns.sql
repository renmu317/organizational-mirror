-- v8.0 新增字段
-- branch: actionable | retrospective (org路径分支)
-- depth_metrics: 对话深度统计
-- close_reason: 收尾原因

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS branch TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS depth_metrics JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS close_reason TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS world_rule TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cognition_layer TEXT DEFAULT 'result';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS layer_sequence JSONB DEFAULT '[]';

-- 索引
CREATE INDEX IF NOT EXISTS idx_sessions_branch ON sessions(branch);
CREATE INDEX IF NOT EXISTS idx_sessions_close_reason ON sessions(close_reason);
