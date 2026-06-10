/**
 * 自动学习模块 (L1 + L2)
 *
 * 功能：
 * 1. 评估会话质量
 * 2. 高质量会话自动转为案例
 * 3. 生成 embedding 存入 Supabase
 *
 * 触发条件：
 * - org: has world_rule + 轮数 >= 6
 * - strategy: strategyReady（非 strategyCap）
 * - early: has_experiment_action + 轮数 >= 4
 */

const { getCaseEmbedding } = require('./embeddings');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ============================================================
// 质量评估
// ============================================================
function calculateQualityScore(state, history, closeReason) {
  let score = 0;
  const turns = state.total_turns || 0;
  const userMessages = history.filter(m => m.role === 'user');

  // 基础分：轮数
  if (turns >= 4) score += 0.2;
  if (turns >= 6) score += 0.1;
  if (turns >= 8) score += 0.1;

  // 路径专属分
  if (state.path === 'org') {
    if (state.world_rule) score += 0.3;  // 有世界规则
    if (state.deepest_layer_reached === 'rule') score += 0.2;
    if (state.causalChain?.length >= 2) score += 0.1;
  } else if (state.path === 'strategy') {
    if (closeReason === 'strategy_ready') score += 0.4;  // 完整收尾
    if (state.has_pressure_test) score += 0.15;
    if (state.has_value_evaluation) score += 0.15;
    if (state.has_prediction) score += 0.1;
  } else if (state.path === 'early') {
    if (state.has_experiment_action) score += 0.3;
    if (state.has_success_definition) score += 0.2;
  }

  // 用户参与度：平均回复长度
  const avgLength = userMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / Math.max(userMessages.length, 1);
  if (avgLength >= 30) score += 0.1;
  if (avgLength >= 50) score += 0.1;

  // 扣分：被兜底截断
  if (closeReason === 'strategy_cap' || closeReason === 'org_cap' || closeReason === 'early_cap') {
    score -= 0.3;
  }

  return Math.min(Math.max(score, 0), 1);
}

// ============================================================
// 判断是否应该采纳
// ============================================================
function shouldAdopt(state, closeReason, qualityScore) {
  // 用户主动结束的不采纳（可能不完整）
  if (closeReason === 'user_requested') {
    return { adopt: false, reason: '用户主动结束' };
  }

  // 路径专属条件
  if (state.path === 'org') {
    if (!state.world_rule) {
      return { adopt: false, reason: 'org 路径但无 world_rule' };
    }
    if ((state.total_turns || 0) < 6) {
      return { adopt: false, reason: 'org 路径轮数 < 6' };
    }
  } else if (state.path === 'strategy') {
    // 【修复】ai_complete 时检查 state 是否满足 strategyReady 条件
    const isValidClose = closeReason === 'strategy_ready'
      || (closeReason === 'ai_complete' && state.has_decision_clarity && state.has_pressure_test && state.has_next_step);
    if (!isValidClose) {
      return { adopt: false, reason: 'strategy 非完整收尾' };
    }
    // strategy 路径：如果是有效收尾，放宽质量分门槛
    if (qualityScore < 0.5) {
      return { adopt: false, reason: `质量分 ${qualityScore.toFixed(2)} < 0.5` };
    }
    return { adopt: true, reason: '符合采纳条件' };
  } else if (state.path === 'early') {
    if (!state.has_experiment_action) {
      return { adopt: false, reason: 'early 路径无实验行动' };
    }
    if ((state.total_turns || 0) < 4) {
      return { adopt: false, reason: 'early 路径轮数 < 4' };
    }
  }

  // 默认质量门槛
  if (qualityScore < 0.6) {
    return { adopt: false, reason: `质量分 ${qualityScore.toFixed(2)} < 0.6` };
  }

  return { adopt: true, reason: '符合采纳条件' };
}

// ============================================================
// 会话转案例
// ============================================================
// 【重要】Supabase cases 表现有列：
// id, created_at (自动), source, industry, surface_problem, initial_explanation,
// causal_chain, hidden_assumptions, real_bottleneck, missing_variables,
// seven_day_experiment, path, completeness, insight_confidence, embedding
//
// 策略型字段映射：
// - decision_chain → causal_chain
// - weakest_link → real_bottleneck
// - hidden_assumption → hidden_assumptions[0]
// - target_outcome, pressure_test_result, prediction, next_step → missing_variables (JSON)
function sessionToCase(state, history, discoveryOutput, sessionId) {
  const userMessages = history.filter(m => m.role === 'user');
  const firstUserMsg = userMessages[0]?.content || '';
  const discovery = discoveryOutput || {};

  // 提取行业
  const industry = extractIndustry(userMessages);

  // 基础字段（不含 timestamp，让 Supabase 自动生成 created_at）
  // 不含 quality_score, turns, close_reason（表中不存在）
  const baseCase = {
    id: `auto_${sessionId}_${Date.now()}`,
    source: 'auto_learn',
    path: state.path,
    industry,
    surface_problem: state.originalProblem || firstUserMsg.slice(0, 200),
    completeness: 'gap'  // 待回访验证后升级
  };

  // 路径专属字段
  if (state.path === 'org') {
    return {
      ...baseCase,
      initial_explanation: userMessages[1]?.content?.slice(0, 200) || '',
      causal_chain: state.causalChain || discovery.causal_chain || [],
      hidden_assumptions: discovery.wrong_assumptions || [],
      real_bottleneck: discovery.redefined_problem || state.redefinedProblem || '',
      missing_variables: discovery.missing_variables || [],
      seven_day_experiment: discovery.seven_day_experiment || null
    };
  } else if (state.path === 'strategy') {
    // 策略型：映射到已有列
    const targetOutcome = discovery.target_outcome || state.target_outcome || '';
    const pressureResult = discovery.pressure_test_result || state.pressure_test_result || '';
    const prediction = discovery.prediction || null;
    const nextStep = discovery.next_step || state.next_step || '';

    return {
      ...baseCase,
      initial_explanation: targetOutcome ? `目标: ${targetOutcome}` : '',
      // decision_chain → causal_chain
      causal_chain: discovery.decision_chain || state.decision_chain || [],
      // hidden_assumption → hidden_assumptions (数组)
      hidden_assumptions: [discovery.hidden_assumption || state.hidden_assumption || ''].filter(Boolean),
      // weakest_link → real_bottleneck
      real_bottleneck: discovery.weakest_link || state.weakest_link || '',
      // 其他策略型字段打包存入 missing_variables
      missing_variables: [
        pressureResult ? `压力测试: ${pressureResult}` : null,
        prediction ? `预测: ${JSON.stringify(prediction)}` : null,
        nextStep ? `下一步: ${nextStep}` : null
      ].filter(Boolean),
      seven_day_experiment: null
    };
  } else if (state.path === 'early') {
    return {
      ...baseCase,
      initial_explanation: discovery.core_assumption || '',
      causal_chain: [],
      hidden_assumptions: [discovery.challenged_assumption || ''].filter(Boolean),
      real_bottleneck: discovery.success_definition || '',
      missing_variables: [],
      seven_day_experiment: discovery.seven_day_experiment || null
    };
  }

  return baseCase;
}

// 从对话中提取行业关键词
function extractIndustry(userMessages) {
  const text = userMessages.map(m => m.content || '').join(' ');

  const industries = {
    '电商': ['电商', '淘宝', '京东', '天猫', '网店', '店铺'],
    '教育': ['教育', '培训', '学校', '课程', '学生', '老师'],
    '餐饮': ['餐饮', '餐厅', '外卖', '食品', '饭店'],
    'SaaS': ['SaaS', '软件', 'B2B', '企业服务', 'API'],
    '制造': ['制造', '工厂', '生产', '供应链', '设备'],
    '金融': ['金融', '银行', '保险', '投资', '理财'],
    '医疗': ['医疗', '医院', '健康', '诊所', '患者'],
    '零售': ['零售', '门店', '超市', '便利店', '商场'],
    '咨询': ['咨询', '顾问', '服务', 'demo', '客户']
  };

  for (const [industry, keywords] of Object.entries(industries)) {
    if (keywords.some(kw => text.includes(kw))) {
      return industry;
    }
  }

  return '其他';
}

// ============================================================
// 存入 Supabase（带 embedding）
// ============================================================
async function saveCaseToSupabase(caseData, embedding) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[AutoLearn] Supabase 未配置，跳过存储');
    return false;
  }

  try {
    const payload = {
      ...caseData,
      embedding: embedding  // pgvector 格式
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/cases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[AutoLearn] Supabase 存储失败:', error);
      return false;
    }

    console.log(`[AutoLearn] 案例已存入 Supabase: ${caseData.id}`);
    return true;
  } catch (error) {
    console.error('[AutoLearn] Supabase 错误:', error.message);
    return false;
  }
}

// ============================================================
// 主入口：尝试自动采纳
// ============================================================
async function tryAutoAdopt(state, history, discoveryOutput, sessionId, closeReason) {
  console.log(`[AutoLearn] 评估会话 ${sessionId}...`);

  // 1. 计算质量分
  const qualityScore = calculateQualityScore(state, history, closeReason);
  console.log(`[AutoLearn] 质量分: ${qualityScore.toFixed(2)}`);

  // 暂存用于 case 记录
  state._qualityScore = qualityScore;
  state._closeReason = closeReason;

  // 2. 判断是否采纳
  const { adopt, reason } = shouldAdopt(state, closeReason, qualityScore);
  if (!adopt) {
    console.log(`[AutoLearn] 不采纳: ${reason}`);
    return { adopted: false, reason };
  }

  // 3. 转为案例
  const caseData = sessionToCase(state, history, discoveryOutput, sessionId);
  console.log(`[AutoLearn] 转为案例: ${caseData.id}, 路径=${caseData.path}, 行业=${caseData.industry}`);

  // 4. 生成 embedding
  let embedding = null;
  try {
    embedding = await getCaseEmbedding(caseData);
    if (embedding) {
      console.log(`[AutoLearn] Embedding 生成成功, 维度=${embedding.length}`);
    } else {
      console.log('[AutoLearn] Embedding 生成失败，继续存储（无向量）');
    }
  } catch (e) {
    console.error('[AutoLearn] Embedding 错误:', e.message);
  }

  // 5. 存入 Supabase
  const saved = await saveCaseToSupabase(caseData, embedding);

  return {
    adopted: true,
    saved,
    caseId: caseData.id,
    qualityScore,
    hasEmbedding: !!embedding
  };
}

module.exports = {
  tryAutoAdopt,
  calculateQualityScore,
  shouldAdopt,
  sessionToCase
};
