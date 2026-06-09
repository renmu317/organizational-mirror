/**
 * 提示词自动优化模块
 *
 * 基于成功对话模式，动态调整 AI 提问策略
 *
 * 功能：
 * 1. 分析成功对话（触发好奇心、完整收敛）
 * 2. 提取有效提问模板
 * 3. 识别失败模式
 * 4. 生成动态提示词补丁
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const PATTERNS_PATH = path.join(__dirname, '..', 'data', 'learned-patterns.json');

// ============================================================
// 模式存储
// ============================================================
let learnedPatterns = {
  // 有效的提问模板（按阶段）
  effectiveQuestions: {
    stage1: [], // 现象故事
    stage2: [], // 因果链
    stage3: [], // 撞击式
    stage4: [], // 收敛
  },

  // 触发好奇心的模式
  curiosityTriggers: [],

  // 失败模式（导致用户离开）
  failurePatterns: [],

  // 高频缺失变量（可以主动探测）
  frequentMissingVars: [],

  // 高频隐藏假设（可以主动挑战）
  frequentAssumptions: [],

  // 更新时间
  lastUpdated: null
};

// 加载已学习的模式
try {
  if (fs.existsSync(PATTERNS_PATH)) {
    learnedPatterns = JSON.parse(fs.readFileSync(PATTERNS_PATH, 'utf-8'));
  }
} catch (e) {
  console.log('[Optimizer] 使用默认模式');
}

// 保存模式
function savePatterns() {
  learnedPatterns.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PATTERNS_PATH, JSON.stringify(learnedPatterns, null, 2), 'utf-8');
}

// ============================================================
// 从 Supabase 拉取会话数据
// ============================================================
async function fetchSessionsForAnalysis() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return [];
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/sessions?select=*&order=created_at.desc&limit=100`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    );

    if (!response.ok) return [];
    return await response.json();
  } catch (e) {
    return [];
  }
}

// ============================================================
// 分析成功对话
// ============================================================
function analyzeSuccessfulSession(session) {
  const history = session.history || [];
  const aiMessages = history.filter(m => m.role === 'assistant');
  const userMessages = history.filter(m => m.role === 'user');

  // 判断是否成功（有完整的7天实验）
  const exp = session.discovery_output?.seven_day_experiment;
  const isSuccess = exp && exp.experiment && !exp.experiment.includes('待');

  if (!isSuccess) return null;

  // 提取有效的提问
  const effectiveQuestions = [];

  aiMessages.forEach((ai, index) => {
    const userResponse = userMessages[index];
    if (!userResponse) return;

    // 检测是否触发了有意义的回答
    const responseQuality = assessResponseQuality(userResponse.content);

    if (responseQuality >= 0.7) {
      effectiveQuestions.push({
        question: ai.content,
        stage: estimateStage(index, aiMessages.length),
        responseQuality,
        triggersCuriosity: detectsCuriosity(userResponse.content)
      });
    }
  });

  return {
    sessionId: session.id,
    path: session.path,
    effectiveQuestions,
    missingVariables: session.discovery_output?.missing_variables || [],
    hiddenAssumptions: session.discovery_output?.world_model?.hidden_assumptions || []
  };
}

// 评估用户回答质量
function assessResponseQuality(content) {
  if (!content) return 0;

  let score = 0.5;

  // 长度适中（不太短也不太长）
  if (content.length >= 20 && content.length <= 200) score += 0.1;

  // 包含数字（具体化）
  if (/\d/.test(content)) score += 0.1;

  // 包含因果关系
  if (/因为|所以|导致|因此/.test(content)) score += 0.1;

  // 包含反思
  if (/没想过|原来|确实|有意思/.test(content)) score += 0.2;

  return Math.min(score, 1.0);
}

// 检测是否触发好奇心
function detectsCuriosity(content) {
  const patterns = [
    /没想过/,
    /有意思/,
    /真的吗/,
    /原来/,
    /不对/,
    /为什么/,
    /怎么会/,
    /\?$/,
    /？$/
  ];

  return patterns.some(p => p.test(content));
}

// 估计阶段
function estimateStage(index, totalMessages) {
  const ratio = index / totalMessages;
  if (ratio < 0.2) return 1;
  if (ratio < 0.4) return 2;
  if (ratio < 0.7) return 3;
  return 4;
}

// ============================================================
// 分析失败对话
// ============================================================
function analyzeFailedSession(session) {
  const history = session.history || [];
  const userMessages = history.filter(m => m.role === 'user');

  // 判断失败原因
  const failureIndicators = {
    tooShort: userMessages.length < 3,
    noExperiment: !session.discovery_output?.seven_day_experiment?.experiment,
    vagueResponses: userMessages.filter(m => m.content.length < 10).length > 2,
    abandoned: history.length > 0 && history.length < 6
  };

  if (!failureIndicators.tooShort && !failureIndicators.abandoned) {
    return null; // 不是明显的失败
  }

  // 找到可能导致失败的问题
  const aiMessages = history.filter(m => m.role === 'assistant');
  const problematicQuestions = [];

  aiMessages.forEach((ai, index) => {
    const userResponse = userMessages[index];
    if (userResponse && userResponse.content.length < 10) {
      problematicQuestions.push(ai.content);
    }
  });

  return {
    sessionId: session.id,
    indicators: failureIndicators,
    problematicQuestions
  };
}

// ============================================================
// 学习并更新模式
// ============================================================
async function learnFromSessions() {
  console.log('[Optimizer] 开始学习...');

  const sessions = await fetchSessionsForAnalysis();
  if (sessions.length === 0) {
    console.log('[Optimizer] 没有会话数据');
    return;
  }

  console.log(`[Optimizer] 分析 ${sessions.length} 条会话`);

  // 分析成功和失败
  const successes = [];
  const failures = [];

  sessions.forEach(s => {
    const success = analyzeSuccessfulSession(s);
    if (success) successes.push(success);

    const failure = analyzeFailedSession(s);
    if (failure) failures.push(failure);
  });

  console.log(`[Optimizer] 成功: ${successes.length}, 失败: ${failures.length}`);

  // 提取有效问题
  const allEffectiveQuestions = successes.flatMap(s => s.effectiveQuestions);
  const questionsByStage = {
    stage1: [],
    stage2: [],
    stage3: [],
    stage4: []
  };

  allEffectiveQuestions.forEach(q => {
    const key = `stage${q.stage}`;
    if (questionsByStage[key]) {
      questionsByStage[key].push(q.question);
    }
  });

  // 更新模式
  learnedPatterns.effectiveQuestions = questionsByStage;

  // 提取好奇心触发器
  learnedPatterns.curiosityTriggers = allEffectiveQuestions
    .filter(q => q.triggersCuriosity)
    .map(q => q.question)
    .slice(0, 10);

  // 提取失败模式
  learnedPatterns.failurePatterns = failures
    .flatMap(f => f.problematicQuestions)
    .slice(0, 10);

  // 提取高频缺失变量
  const allMissingVars = successes.flatMap(s => s.missingVariables);
  const varCounts = {};
  allMissingVars.forEach(v => {
    varCounts[v] = (varCounts[v] || 0) + 1;
  });
  learnedPatterns.frequentMissingVars = Object.entries(varCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([v]) => v);

  // 提取高频假设
  const allAssumptions = successes.flatMap(s => s.hiddenAssumptions);
  const assumptionCounts = {};
  allAssumptions.forEach(a => {
    assumptionCounts[a] = (assumptionCounts[a] || 0) + 1;
  });
  learnedPatterns.frequentAssumptions = Object.entries(assumptionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([a]) => a);

  savePatterns();
  console.log('[Optimizer] 模式已更新');

  return learnedPatterns;
}

// ============================================================
// 生成动态提示词补丁
// ============================================================
function generatePromptPatch(state) {
  const patches = [];

  // 根据阶段添加有效问题示例
  const stageKey = `stage${state.stage}`;
  const effectiveQs = learnedPatterns.effectiveQuestions[stageKey] || [];
  if (effectiveQs.length > 0) {
    const samples = effectiveQs.slice(0, 3);
    patches.push(`【数据驱动的有效问题示例】\n${samples.map((q, i) => `${i + 1}. ${q.slice(0, 100)}`).join('\n')}`);
  }

  // 添加高频缺失变量提示
  if (state.stage >= 3 && learnedPatterns.frequentMissingVars.length > 0) {
    const vars = learnedPatterns.frequentMissingVars.slice(0, 5);
    patches.push(`【常见缺失变量】\n用户经常忽略: ${vars.join('、')}\n可以针对性提问`);
  }

  // 添加好奇心触发提示
  if (learnedPatterns.curiosityTriggers.length > 0 && state.stage >= 2) {
    patches.push(`【触发好奇心的问法】\n尝试用反问或对比：涨还是跌？有没有可能相反？`);
  }

  // 避免失败模式
  if (learnedPatterns.failurePatterns.length > 0) {
    patches.push(`【避免这类问题】\n过于开放或抽象的问题容易导致用户放弃`);
  }

  return patches.length > 0 ? '\n\n' + patches.join('\n\n') : '';
}

// ============================================================
// 获取当前模式
// ============================================================
function getLearnedPatterns() {
  return learnedPatterns;
}

module.exports = {
  learnFromSessions,
  generatePromptPatch,
  getLearnedPatterns
};
