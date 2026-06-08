/**
 * 组织镜子 v3 - 开场分流 + 双路径 + 收敛封顶
 *
 * API 端点:
 * - POST /api/respond - 核心对话接口
 * - POST /api/session/save - 保存完成的对话
 * - GET /api/stats - 获取案例库统计
 * - GET /api/health - 健康检查
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  buildSystemPrompt,
  getOpeningMessage,
  detectPath,
  detectVagueResponse,
  isResponseTooShort,
  detectBehavioralSignal,
  extractCausalChain,
  buildCaseHints
} = require('./prompts/consultant');

// 会话状态存储（内存中）
const sessionStates = new Map();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// 数据文件路径
const CASE_LIBRARY_PATH = path.join(__dirname, 'data', 'caseLibrary.json');
const SESSIONS_PATH = path.join(__dirname, 'data', 'sessions.json');

// ============================================================
// 封顶配置 - 确保对话收敛到7天实验
// 用户要求: 最少10轮探索，最大30轮硬上限
// ============================================================
const CAPS = {
  early: {
    maxTotalTurns: 15,      // 最多15轮必须结束
    softLimit: 10,          // 10轮后开始收尾引导
    stageMaxTurns: { 1: 3, 2: 3, 3: 2, 4: 2 }
  },
  org: {
    maxTotalTurns: 30,      // 最多30轮必须结束（硬上限）
    softLimit: 20,          // 20轮后开始收尾引导
    stageMaxTurns: { 1: 4, 2: 5, 3: 5, 4: 4, 5: 4, 6: 4 }
  }
};

// ============================================================
// 渐进收尾压力 - 根据轮数返回收尾压力级别
// ============================================================
function getWrapUpPressure(totalTurns, caps) {
  const { softLimit, maxTotalTurns } = caps;
  if (totalTurns < softLimit) return 'none';
  if (totalTurns < softLimit + 3) return 'hint';        // 提示可以收尾
  if (totalTurns < softLimit + 6) return 'encourage';   // 鼓励收尾
  if (totalTurns < maxTotalTurns - 2) return 'push';    // 推动收尾
  return 'force';                                        // 强制收尾
}

// ============================================================
// 数据加载函数
// ============================================================
function loadCaseLibrary() {
  try {
    if (fs.existsSync(CASE_LIBRARY_PATH)) {
      const data = fs.readFileSync(CASE_LIBRARY_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('加载案例库失败:', error.message);
  }
  return [];
}

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_PATH)) {
      const data = fs.readFileSync(SESSIONS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('加载会话记录失败:', error.message);
  }
  return [];
}

function saveSessions(sessions) {
  try {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存会话记录失败:', error.message);
    return false;
  }
}

// ============================================================
// 案例匹配
// ============================================================
function calculateMatchScore(caseData, userText, stage) {
  let score = 0;

  if (caseData.industry && userText.includes(caseData.industry)) {
    score += 20;
  }

  if (caseData.surface_problem) {
    const keywords = caseData.surface_problem.split(/[，,。；\s]+/).filter(k => k.length >= 2);
    keywords.forEach(kw => {
      if (userText.includes(kw)) score += 5;
    });
  }

  if (caseData.initial_explanation) {
    const keywords = caseData.initial_explanation.split(/[，,。；\s]+/).filter(k => k.length >= 2);
    keywords.forEach(kw => {
      if (userText.includes(kw)) score += 3;
    });
  }

  if (stage >= 3 && caseData.real_bottleneck) {
    score += 15;
  }

  if (caseData.completeness === 'enriched') {
    score += 15;
  }

  if (caseData.insight_confidence === 'high') {
    score += 10;
  }

  return score;
}

function searchCases(history, stage) {
  const cases = loadCaseLibrary();
  const activeCases = cases.filter(c =>
    c.completeness === 'gap' || c.completeness === 'enriched'
  );

  if (activeCases.length === 0) {
    return [];
  }

  const userText = history
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ');

  const scoredCases = activeCases
    .map(c => ({
      ...c,
      score: calculateMatchScore(c, userText, stage)
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scoredCases;
}

// ============================================================
// DeepSeek API 调用
// ============================================================
async function callDeepSeek(systemPrompt, messages) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 1500
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ============================================================
// 解析 AI 响应
// ============================================================
function parseAIResponse(content) {
  try {
    return JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        return createDefaultResponse(content);
      }
    }
    return createDefaultResponse(content);
  }
}

function createDefaultResponse(content) {
  return {
    reply: content,
    path: 'unknown',
    stage: 1,
    stage_turn: 0,
    total_turns: 0,
    causal_chain: [],
    difficulty: 'L1',
    question_kind: 'definition',
    options: [],
    curiosity_triggered: false,
    redefined_problem: '',
    session_hint: null,
    internal_note: 'Failed to parse JSON',
    session_complete: false
  };
}

// ============================================================
// 会话状态管理
// ============================================================
function getOrCreateState(sessionId) {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      path: 'unknown',
      stage: 1,
      stage_turn: 0,
      total_turns: 0,
      difficulty: 'L1',
      vague_streak: 0,
      causalChain: [],
      originalProblem: '',
      curiosityTriggered: false,
      redefinedProblem: '',
      userPhrasings: []
    });
  }
  return sessionStates.get(sessionId);
}

// ============================================================
// 难度升降级逻辑
// ============================================================
function updateDifficulty(state, userReply) {
  const isVague = detectVagueResponse(userReply);
  const isShort = isResponseTooShort(userReply, 10);

  if (isVague || isShort) {
    state.vague_streak++;

    // 降级条件：连续2次模糊 或 连续2次过短 或 1模糊+1过短
    if (state.vague_streak >= 2) {
      if (state.difficulty === 'L1') {
        state.difficulty = 'L2';
      } else if (state.difficulty === 'L2') {
        state.difficulty = 'L3';
      }
      state.vague_streak = 0; // 降级后重置
    }
  } else {
    // 好回复
    if (state.vague_streak < 0) {
      state.vague_streak--;
    } else {
      state.vague_streak = -1;
    }

    // 升级条件：连续2次好回复
    if (state.vague_streak <= -2) {
      if (state.difficulty === 'L3') {
        state.difficulty = 'L2';
      } else if (state.difficulty === 'L2') {
        state.difficulty = 'L1';
      }
      state.vague_streak = 0;
    }
  }
}

// ============================================================
// 封顶检查
// ============================================================
function checkCaps(state) {
  const caps = CAPS[state.path] || CAPS.org;
  const result = {
    shouldAdvanceStage: false,
    shouldEndSession: false,
    sessionHint: null
  };

  // 阶段内轮数封顶（推进到下一阶段，但不强制结束）
  const stageMaxTurns = caps.stageMaxTurns[state.stage] || 3;
  if (state.stage_turn >= stageMaxTurns) {
    result.shouldAdvanceStage = true;
  }

  // 软提示（提醒 AI 可以开始收尾，但不强制）
  if (state.total_turns >= caps.softLimit) {
    result.sessionHint = 'can_wrap_up';
  }

  // 硬封顶（安全网，几乎不会触发）
  if (state.total_turns >= caps.maxTotalTurns) {
    result.shouldEndSession = true;
    result.sessionHint = 'max_reached';
  }

  return result;
}

// ============================================================
// 校验并清理 options（L3 红线）
// ============================================================
function enforceL3Redline(parsed) {
  // 如果 question_kind 不是 fact，强制清空 options
  if (parsed.question_kind !== 'fact' && parsed.options && parsed.options.length > 0) {
    parsed.options = [];
  }

  // 如果 difficulty 不是 L3，也清空 options
  if (parsed.difficulty !== 'L3' && parsed.options && parsed.options.length > 0) {
    parsed.options = [];
  }

  return parsed;
}

// ============================================================
// 核心对话接口
// ============================================================
app.post('/api/respond', async (req, res) => {
  try {
    const { history, sessionId } = req.body;
    const sid = sessionId || `S${Date.now()}`;

    // 新对话返回开场白
    if (!history || history.length === 0) {
      const opening = getOpeningMessage();
      // 剥掉 internal_note
      const { internal_note, ...publicOpening } = opening;
      return res.json({
        ...publicOpening,
        sessionId: sid
      });
    }

    // 获取会话状态
    const state = getOrCreateState(sid);

    // 获取最后一条用户消息
    const lastUserMessage = history[history.length - 1]?.content || '';

    // 计算用户消息数量（更可靠的轮数计算）
    const userMessageCount = history.filter(m => m.role === 'user').length;

    // 使用历史消息数量和内存计数的较大值（防止页面刷新导致计数丢失）
    const actualTurns = Math.max(state.total_turns + 1, userMessageCount);
    state.total_turns = actualTurns;
    state.stage_turn++;

    // 计算当前的收尾压力（用于日志）
    const currentCaps = CAPS[state.path] || CAPS.org;
    const currentPressure = getWrapUpPressure(state.total_turns, currentCaps);

    // 调试日志
    console.log(`[DEBUG] Turn ${state.total_turns}: path=${state.path}, stage=${state.stage}, stage_turn=${state.stage_turn}, pressure=${currentPressure}`);

    // 开场分流（仅在 path=unknown 时）
    if (state.path === 'unknown') {
      const pathResult = detectPath(lastUserMessage);
      if (pathResult.path !== 'unknown') {
        state.path = pathResult.path;
        state.stage = 1;
        state.stage_turn = 0;
        state.difficulty = 'L1';
        state.vague_streak = 0;
      }
      // 仍然 unknown 且已问过一次，默认 early
      else if (state.total_turns >= 2) {
        state.path = 'early';
        state.stage = 1;
        state.stage_turn = 0;
      }
    }

    // 更新难度
    updateDifficulty(state, lastUserMessage);

    // 检测行为信号并可能推进阶段 - 渐进式推进（允许更多探索）
    let shouldAdvance = false;

    // 记录原始问题（第一条用户消息）
    if (!state.originalProblem && lastUserMessage) {
      state.originalProblem = lastUserMessage.slice(0, 100);
    }

    // 获取当前阶段的最大轮数限制
    const pathCaps = CAPS[state.path] || CAPS.org;
    const stageMaxTurns = pathCaps.stageMaxTurns[state.stage] || 3;

    if (state.path === 'org') {
      // org 路阶段推进逻辑 - 检测信号或达到阶段上限时推进
      if (state.stage_turn >= stageMaxTurns) {
        shouldAdvance = true; // 达到阶段硬上限，强制推进
      } else if (state.stage === 1) {
        // Stage 1: 现象故事 - 需要数字或时间点
        const storyResult = detectBehavioralSignal(lastUserMessage, 'STORY_COMPLETE');
        if (storyResult.detected && state.stage_turn >= 2) {
          shouldAdvance = true; // 有信号且已探索足够
        }
      } else if (state.stage === 2) {
        // Stage 2: 因果链 - 需要因果关系
        const causalResult = detectBehavioralSignal(lastUserMessage, 'CAUSAL_CHAIN_DONE');
        if (causalResult.detected) {
          const chain = extractCausalChain(lastUserMessage);
          if (chain.length > 0) {
            state.causalChain = chain;
          }
          if (state.stage_turn >= 2) shouldAdvance = true;
        }
      } else if (state.stage === 3) {
        // Stage 3: 撞击式提问 - 核心阶段，可以多待几轮
        const curiosityResult = detectBehavioralSignal(lastUserMessage, 'CURIOSITY');
        if (curiosityResult.detected) {
          state.curiosityTriggered = true;
          if (state.stage_turn >= 2) shouldAdvance = true;
        }
      } else if (state.stage >= 4) {
        // Stage 4-6: 收尾阶段，检测信号后推进
        if (state.stage_turn >= 2) shouldAdvance = true;
      }
    } else if (state.path === 'early') {
      // early 路：阶段上限控制，允许更多探索
      if (state.stage_turn >= stageMaxTurns) {
        shouldAdvance = true;
      }
    }

    // 检查封顶
    const capsResult = checkCaps(state);
    if (capsResult.shouldAdvanceStage) {
      shouldAdvance = true;
    }

    // 推进阶段
    if (shouldAdvance) {
      const maxStage = state.path === 'early' ? 4 : 6;
      if (state.stage < maxStage) {
        state.stage++;
        state.stage_turn = 0;
        state.difficulty = 'L1'; // 切换阶段重置难度
        state.vague_streak = 0;
      }
    }

    // 检索相关案例（仅 org 路 Stage 3+）
    let caseHints = [];
    if (state.path === 'org' && state.stage >= 3) {
      const matchedCases = searchCases(history, state.stage);
      caseHints = buildCaseHints(matchedCases);
    }

    // 计算渐进收尾压力
    const caps = CAPS[state.path] || CAPS.org;
    const wrapUpPressure = getWrapUpPressure(state.total_turns, caps);

    // 是否到达最后阶段（用于备用判断）
    const maxStageForWrapUp = state.path === 'early' ? 4 : 6;
    const atFinalStage = state.stage >= maxStageForWrapUp;

    // 构建系统提示词（传入收尾压力级别）
    const systemPrompt = buildSystemPrompt(caseHints, state, wrapUpPressure);

    // 调用 DeepSeek
    const aiContent = await callDeepSeek(systemPrompt, history);

    // 解析响应
    let parsed = parseAIResponse(aiContent);

    // 执行 L3 红线校验
    parsed = enforceL3Redline(parsed);

    // 更新因果链
    if (parsed.causal_chain && parsed.causal_chain.length > 0) {
      state.causalChain = parsed.causal_chain;
    }

    // 更新好奇心触发
    if (parsed.curiosity_triggered) {
      state.curiosityTriggered = true;
    }

    // 更新重定义问题
    if (parsed.redefined_problem) {
      state.redefinedProblem = parsed.redefined_problem;
    }

    // 记录原始问题
    if (state.stage === 1 && !state.originalProblem && lastUserMessage) {
      state.originalProblem = lastUserMessage.slice(0, 100);
    }

    // 检查是否应该结束会话
    const maxStage = state.path === 'early' ? 4 : 6;
    const shouldEnd = capsResult.shouldEndSession ||
                      parsed.session_complete ||
                      (state.stage >= maxStage && state.stage_turn >= 1);

    // 调试日志
    console.log(`[DEBUG] End check: shouldEnd=${shouldEnd}, pressure=${wrapUpPressure}, session_complete=${parsed.session_complete}, stage=${state.stage}/${maxStage}`);

    // 构建响应（剥掉 internal_note）
    const response = {
      reply: parsed.reply,
      path: state.path,
      stage: state.stage,
      stage_turn: state.stage_turn,
      total_turns: state.total_turns,
      causal_chain: state.causalChain,
      difficulty: state.difficulty,
      question_kind: parsed.question_kind || 'definition',
      options: parsed.options || [],
      curiosity_triggered: state.curiosityTriggered,
      redefined_problem: state.redefinedProblem,
      session_hint: capsResult.sessionHint || parsed.session_hint,
      session_complete: shouldEnd,
      sessionId: sid
    };

    // 如果会话完成，包含发现输出
    if (shouldEnd) {
      response.discovery_output = parsed.discovery_output || buildDefaultDiscoveryOutput(state, history);
      sessionStates.delete(sid);
    }

    res.json(response);

  } catch (error) {
    console.error('对话处理错误:', error);
    res.status(500).json({
      error: error.message,
      reply: '抱歉，系统遇到了一些问题。请稍后再试。'
    });
  }
});

// ============================================================
// 构建默认发现输出（从对话历史中提取内容）
// ============================================================
function buildDefaultDiscoveryOutput(state, history = []) {
  // 提取用户消息
  const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
  const aiMessages = history.filter(m => m.role === 'assistant').map(m => m.content);

  // 第一条用户消息作为原始问题
  const originalProblem = state.originalProblem || userMessages[0] || '未记录';

  // 尝试从对话中提取因果链
  const causalChain = state.causalChain?.length > 0
    ? state.causalChain
    : extractCausalChainFromHistory(userMessages);

  // 尝试找到重定义的问题（通常在后期对话中）
  const redefinedProblem = state.redefinedProblem ||
    findRedefinedProblem(userMessages) ||
    originalProblem;

  // 尝试找到好奇问题（用户提出的问题）
  const curiosityQuestions = extractUserQuestions(userMessages);

  // 尝试找到实验描述
  const experimentContent = findExperimentContent(userMessages, aiMessages);

  if (state.path === 'early') {
    return {
      current_idea: originalProblem,
      core_assumption: findCoreAssumption(userMessages) || '用户的核心假设',
      challenged_assumption: findChallengedAssumption(userMessages) || '被挑战的假设',
      prediction: findPrediction(userMessages) || '用户的预测',
      success_definition: findSuccessDefinition(userMessages) || '验证成功的定义',
      redefined_problem: redefinedProblem,
      seven_day_experiment: {
        experiment: experimentContent.experiment || '待设计的最小实验',
        success_criteria: experimentContent.criteria || '成功标准',
        time_horizon: '7天',
        owner: '你'
      }
    };
  } else {
    return {
      current_problem: originalProblem,
      world_model: {
        causal_chain: causalChain,
        hidden_assumptions: findHiddenAssumptions(userMessages)
      },
      missing_variables: findMissingVariables(userMessages, aiMessages),
      curiosity_questions: curiosityQuestions,
      redefined_problem: redefinedProblem,
      seven_day_experiment: {
        hypothesis: experimentContent.hypothesis || '待验证的假设',
        experiment: experimentContent.experiment || '本周可执行的最小实验',
        success_criteria: experimentContent.criteria || '成功标准',
        time_horizon: '7天',
        owner: '你'
      }
    };
  }
}

// 从历史中提取因果链
function extractCausalChainFromHistory(userMessages) {
  const chain = [];
  for (const msg of userMessages) {
    const extracted = extractCausalChain(msg);
    if (extracted.length > 0) {
      chain.push(...extracted);
    }
  }
  return [...new Set(chain)].slice(0, 5); // 去重，最多5个节点
}

// 寻找重定义的问题
function findRedefinedProblem(userMessages) {
  // 后期消息更可能包含重定义
  for (let i = userMessages.length - 1; i >= Math.max(0, userMessages.length - 3); i--) {
    const msg = userMessages[i];
    if (msg && (msg.includes('问题是') || msg.includes('原来是') || msg.includes('其实是'))) {
      return msg.slice(0, 100);
    }
  }
  return null;
}

// 提取用户问题
function extractUserQuestions(userMessages) {
  const questions = [];
  for (const msg of userMessages) {
    if (msg && (msg.includes('？') || msg.includes('?'))) {
      const q = msg.match(/[^。！？]*[？?]/g);
      if (q) questions.push(...q);
    }
  }
  return questions.slice(0, 3);
}

// 找核心假设（早期路径）
function findCoreAssumption(userMessages) {
  for (const msg of userMessages) {
    if (msg.includes('我以为') || msg.includes('我觉得') || msg.includes('应该是')) {
      return msg.slice(0, 80);
    }
  }
  return null;
}

// 找被挑战的假设
function findChallengedAssumption(userMessages) {
  for (const msg of userMessages) {
    if (msg.includes('没想过') || msg.includes('原来') || msg.includes('确实')) {
      return msg.slice(0, 80);
    }
  }
  return null;
}

// 找预测
function findPrediction(userMessages) {
  for (const msg of userMessages) {
    if (msg.includes('个') && /\d/.test(msg)) {
      return msg.slice(0, 80);
    }
  }
  return null;
}

// 找成功定义
function findSuccessDefinition(userMessages) {
  for (const msg of userMessages) {
    if ((msg.includes('成功') || msg.includes('验证')) && /\d/.test(msg)) {
      return msg.slice(0, 80);
    }
  }
  return null;
}

// 找隐藏假设
function findHiddenAssumptions(userMessages) {
  const assumptions = [];
  for (const msg of userMessages) {
    if (msg.includes('我一直以为') || msg.includes('我默认') || msg.includes('当然是')) {
      assumptions.push(msg.slice(0, 60));
    }
  }
  return assumptions.slice(0, 2);
}

// 找缺失变量
function findMissingVariables(userMessages, aiMessages) {
  const variables = [];
  // 从 AI 提问中找（通常包含缺失变量方向）
  for (const msg of aiMessages) {
    if (msg.includes('是涨还是跌') || msg.includes('有没有')) {
      const match = msg.match(/[^，。？]+是涨还是跌|[^，。？]+有没有/);
      if (match) variables.push(match[0]);
    }
  }
  // 从用户"没想过"的内容中找
  for (const msg of userMessages) {
    if (msg.includes('没想过')) {
      variables.push(msg.slice(0, 40));
    }
  }
  return variables.slice(0, 3);
}

// 找实验内容
function findExperimentContent(userMessages, aiMessages) {
  let experiment = '';
  let criteria = '';
  let hypothesis = '';

  for (const msg of userMessages) {
    // 找实验描述
    if (msg.includes('验证') || msg.includes('测试') || msg.includes('试试') || msg.includes('7天') || msg.includes('这周')) {
      experiment = msg.slice(0, 100);
    }
    // 找成功标准
    if ((msg.includes('成功') || msg.includes('说明')) && /\d/.test(msg)) {
      criteria = msg.slice(0, 80);
    }
    // 找假设
    if (msg.includes('如果') || msg.includes('假设')) {
      hypothesis = msg.slice(0, 80);
    }
  }

  return { experiment, criteria, hypothesis };
}

// ============================================================
// 保存会话
// ============================================================
app.post('/api/session/save', async (req, res) => {
  try {
    const { history, discoveryOutput } = req.body;

    if (!history || history.length === 0) {
      return res.status(400).json({ error: 'No history provided' });
    }

    const sessions = loadSessions();
    const userMessages = history.filter(m => m.role === 'user');

    const session = {
      id: `S${Date.now()}`,
      timestamp: new Date().toISOString(),
      surface_problem: userMessages[0]?.content || '',
      initial_explanation: userMessages.length > 1 ? userMessages[1]?.content : '',
      history: history,
      discovery_output: discoveryOutput || null,
      followup_result: null,
      followup_due: discoveryOutput?.seven_day_experiment ?
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
    };

    sessions.push(session);
    saveSessions(sessions);

    res.json({ success: true, sessionId: session.id });

  } catch (error) {
    console.error('保存会话错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 统计接口
// ============================================================
app.get('/api/stats', (req, res) => {
  const cases = loadCaseLibrary();

  const stats = {
    total: cases.length,
    skeleton: cases.filter(c => c.completeness === 'skeleton').length,
    gap: cases.filter(c => c.completeness === 'gap').length,
    enriched: cases.filter(c => c.completeness === 'enriched').length,
    active: cases.filter(c => c.completeness === 'gap' || c.completeness === 'enriched').length,
    highConfidence: cases.filter(c => c.insight_confidence === 'high').length
  };

  res.json(stats);
});

// ============================================================
// 回访更新
// ============================================================
app.post('/api/session/followup', async (req, res) => {
  try {
    const { sessionId, result, improved } = req.body;

    if (!sessionId || result === undefined) {
      return res.status(400).json({ error: 'Missing sessionId or result' });
    }

    const sessions = loadSessions();
    const session = sessions.find(s => s.id === sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.followup_result = {
      timestamp: new Date().toISOString(),
      result: result,
      improved: improved,
      validated: improved
    };

    session.insight_confidence = improved ? 'high' : 'needs_review';

    saveSessions(sessions);

    res.json({
      success: true,
      message: improved
        ? '实验结果正向，归因已验证'
        : '实验结果未达预期，该案例将被复审'
    });

  } catch (error) {
    console.error('回访更新错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 待回访查询
// ============================================================
app.get('/api/sessions/pending-followup', (req, res) => {
  const sessions = loadSessions();
  const now = new Date();

  const pending = sessions.filter(s => {
    if (!s.followup_due || s.followup_result) return false;
    return new Date(s.followup_due) <= now;
  });

  res.json({
    count: pending.length,
    sessions: pending.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      surface_problem: s.surface_problem,
      experiment: s.discovery_output?.seven_day_experiment?.experiment,
      followup_due: s.followup_due
    }))
  });
});

// ============================================================
// 健康检查
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.0-dual-path',
    hasApiKey: !!DEEPSEEK_API_KEY,
    caseLibraryExists: fs.existsSync(CASE_LIBRARY_PATH),
    architecture: 'early-org-dual-path'
  });
});

// ============================================================
// 启动服务器
// ============================================================
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('组织镜子 v3 - 开场分流 + 双路径 + 收敛封顶');
  console.log('='.repeat(60));
  console.log(`\n访问地址: http://localhost:${PORT}\n`);

  if (!DEEPSEEK_API_KEY) {
    console.log('⚠️  警告: DEEPSEEK_API_KEY 未配置');
    console.log('   请复制 .env.example 为 .env 并填入 API Key\n');
  }

  const cases = loadCaseLibrary();
  if (cases.length > 0) {
    const active = cases.filter(c =>
      c.completeness === 'gap' || c.completeness === 'enriched'
    ).length;
    console.log(`案例库状态: ${active} 条活跃案例 / ${cases.length} 条总计`);
  } else {
    console.log('⚠️  案例库为空');
  }

  console.log('\n双路径架构（渐进收尾）:');
  console.log('  early: 验证式轻流程 (10轮后开始收尾, 最多15轮)');
  console.log('  org:   6-Stage 撞击式 (20轮后开始收尾, 最多30轮)');
  console.log('\n收尾压力级别:');
  console.log('  hint → encourage → push → force');

  console.log('\n' + '='.repeat(60));
});
