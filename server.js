/**
 * 组织镜子 v8 - 全路径硬收尾 + 用户结束按钮
 *
 * v8 核心改动：
 * 1. 全路径硬收尾条件（不依赖 AI 的 session_complete）：
 *    - retrospectiveDone: retrospective 分支 + world_rule
 *    - actionableDone: actionable 分支 + world_rule + 1轮
 *    - earlyReady: early 路径 + 成功定义 + 实验行动
 *    - earlyCap: early 路径 8轮硬上限
 *    - orgCap: org 路径 18轮硬上限
 *    - userRequestedEnd: 用户点击"结束并生成卡片"
 * 2. 前端常驻"结束并生成卡片"按钮
 * 3. 防止 early 路径无限循环提问
 *
 * API 端点:
 * - POST /api/respond - 核心对话接口（新增 endRequested 参数）
 * - POST /api/session/save - 保存完成的对话
 * - GET /api/stats - 获取案例库统计
 * - GET /api/stats/depth - 对话深度统计
 * - GET /api/health - 健康检查
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

// 【v7】简化导入 - 只保留必要函数
const {
  buildSystemPrompt,
  getOpeningMessage,
  detectVagueResponse,
  isResponseTooShort,
  shouldProbeAssumption,
  detectRetrospective,
  buildCaseHints
} = require('./prompts/consultant');

// 向量检索和提示词优化（可选模块）
let vectorSearch = null;
let promptOptimizer = null;

try {
  vectorSearch = require('./lib/vector-search');
  promptOptimizer = require('./lib/prompt-optimizer');
  console.log('✓ 向量检索和提示词优化模块已加载');
} catch (e) {
  console.log('⚠ 向量检索/优化模块未加载（可选）');
}

// 会话状态存储（内存中）
const sessionStates = new Map();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Supabase 配置（用于线上数据持久化）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// 数据文件路径
const CASE_LIBRARY_PATH = path.join(__dirname, 'data', 'caseLibrary.json');
const SESSIONS_PATH = path.join(__dirname, 'data', 'sessions.json');

// ============================================================
// 【v7】软上限配置（不是强制收尾）
// ============================================================
const SOFT_CAPS = {
  early: 6,   // early 约 6 轮后温和收束
  org: 15     // org 约 15 轮后温和收束
};

// ============================================================
// 认知深度映射
// ============================================================
const LAYER_DEPTH_MAP = {
  'result': 1,
  'behavior': 2,
  'decision': 3,
  'assumption': 4,
  'environment': 5,
  'rule': 6
};

// ============================================================
// 计算对话深度指标
// ============================================================
function calculateDepthMetrics(layerSequence) {
  if (!layerSequence || layerSequence.length === 0) {
    return {
      layer_sequence: [],
      max_depth: 0,
      broke_assumption: false,
      reached_rule: false,
      turns: 0
    };
  }

  const depths = layerSequence.map(layer => LAYER_DEPTH_MAP[layer] || 1);
  const maxDepth = Math.max(...depths);

  return {
    layer_sequence: layerSequence,
    max_depth: maxDepth,
    broke_assumption: maxDepth >= 4,
    reached_rule: maxDepth === 6,
    turns: layerSequence.length
  };
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
// Supabase 数据持久化
// ============================================================
async function saveSessionToSupabase(session) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[Supabase] 未配置，跳过云端保存');
    return false;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        id: session.id,
        created_at: session.timestamp,
        surface_problem: session.surface_problem,
        initial_explanation: session.initial_explanation,
        history: session.history,
        discovery_output: session.discovery_output,
        path: session.path || 'unknown',
        branch: session.branch || null,
        followup_due: session.followup_due
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Supabase] 保存失败:', error);
      return false;
    }

    console.log('[Supabase] 会话已保存:', session.id);
    return true;
  } catch (error) {
    console.error('[Supabase] 保存错误:', error.message);
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
    branch: null,
    stage: 1,
    cognition_layer: 'result',
    causal_chain: [],
    curiosity_triggered: false,
    probe_triggered: false,
    redefined_problem: '',
    world_rule: '',
    difficulty: 'L1',
    question_kind: 'definition',
    options: [],
    session_hint: null,
    internal_note: 'Failed to parse JSON',
    session_complete: false
  };
}

// ============================================================
// 【v8】硬收尾阈值配置
// ============================================================
const HARD_CAPS = {
  early: 8,   // early 硬上限 8 轮
  org: 18     // org 硬上限 18 轮
};

// ============================================================
// 【v8】会话状态管理（增加收尾追踪字段）
// ============================================================
function getOrCreateState(sessionId) {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, {
      // 基础状态
      path: 'unknown',
      branch: null,           // actionable | retrospective (org only)
      stage: 1,
      total_turns: 0,
      difficulty: 'L1',
      vague_streak: 0,

      // 内容记录
      causalChain: [],
      originalProblem: '',
      redefinedProblem: '',
      world_rule: '',         // 用户认领的世界规则

      // 认知深度追踪
      cognition_layer: 'result',
      shallow_streak: 0,
      deepest_layer_reached: 'result',
      layer_sequence: [],

      // 标记
      curiosityTriggered: false,
      probe_triggered: false,

      // 【v8 新增】收尾追踪
      rule_turn_count: 0,           // 挖到 world_rule 后又问了几轮
      has_success_definition: false, // early: 用户是否给出了成功定义
      has_experiment_action: false   // early: 用户是否给出了实验行动
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
    if (state.vague_streak >= 2) {
      if (state.difficulty === 'L1') state.difficulty = 'L2';
      else if (state.difficulty === 'L2') state.difficulty = 'L3';
      state.vague_streak = 0;
    }
  } else {
    if (state.vague_streak < 0) state.vague_streak--;
    else state.vague_streak = -1;

    if (state.vague_streak <= -2) {
      if (state.difficulty === 'L3') state.difficulty = 'L2';
      else if (state.difficulty === 'L2') state.difficulty = 'L1';
      state.vague_streak = 0;
    }
  }
}

// ============================================================
// 【v8】从 AI JSON 更新状态（主驱动）
// ============================================================
function updateStateFromAIResponse(state, parsed, userReply) {
  // 1. path（AI 判定为主，首次确定后锁定）
  if (state.path === 'unknown' && parsed.path && parsed.path !== 'unknown') {
    state.path = parsed.path;
    state.stage = 1;
    state.difficulty = 'L1';
    state.vague_streak = 0;
  }

  // 2. branch（org only；一旦 retrospective 锁定）
  if (state.path === 'org') {
    // AI 返回 retrospective 或 JS 兜底检测
    if (parsed.branch === 'retrospective' || detectRetrospective(userReply)) {
      state.branch = 'retrospective';
    } else if (!state.branch) {
      state.branch = parsed.branch || 'actionable';
    }
  }

  // 3. cognition_layer + shallow_streak + deepest
  const layer = parsed.cognition_layer || 'result';
  state.cognition_layer = layer;

  const shallowLayers = ['result', 'behavior', 'decision'];
  if (shallowLayers.includes(layer)) {
    state.shallow_streak++;
  } else {
    state.shallow_streak = 0;
    const depth = LAYER_DEPTH_MAP[layer] || 1;
    const prevDepth = LAYER_DEPTH_MAP[state.deepest_layer_reached] || 1;
    if (depth > prevDepth) {
      state.deepest_layer_reached = layer;
    }
  }

  // 记录层级序列
  if (!state.layer_sequence) state.layer_sequence = [];
  state.layer_sequence.push(layer);

  // 4. causal_chain
  if (parsed.causal_chain && parsed.causal_chain.length > 0) {
    state.causalChain = parsed.causal_chain;
  }

  // 5. world_rule + 【v8】rule_turn_count 追踪
  const hadWorldRule = !!(state.world_rule && state.world_rule.trim());
  if (parsed.world_rule && parsed.world_rule.trim()) {
    state.world_rule = parsed.world_rule;
  }
  // 如果已有 world_rule，每轮 +1
  if (state.world_rule && state.world_rule.trim()) {
    if (hadWorldRule) {
      state.rule_turn_count = (state.rule_turn_count || 0) + 1;
    } else {
      state.rule_turn_count = 0; // 刚挖到，从 0 开始
    }
  }

  // 6. curiosity / probe
  if (parsed.curiosity_triggered) state.curiosityTriggered = true;
  if (parsed.probe_triggered || shouldProbeAssumption(userReply)) {
    state.probe_triggered = true;
  }

  // 7. redefined_problem
  if (parsed.redefined_problem) state.redefinedProblem = parsed.redefined_problem;

  // 8. stage（AI 返回的 stage）
  if (parsed.stage && parsed.stage > state.stage) {
    state.stage = parsed.stage;
    state.difficulty = 'L1';  // 阶段切换重置难度
    state.vague_streak = 0;
  }

  // 【v8】early 路径收尾追踪
  if (state.path === 'early') {
    // 检测成功定义
    if (detectSuccessDefinition(userReply)) {
      state.has_success_definition = true;
    }
    // 检测实验行动
    if (detectExperimentAction(userReply)) {
      state.has_experiment_action = true;
    }
  }
}

// ============================================================
// 【v8】early 路径收尾检测
// ============================================================
function detectSuccessDefinition(userReply) {
  const r = (userReply || '').toLowerCase();
  // 有数字 + 成功/验证相关词
  const hasNumber = /\d/.test(r);
  const hasSuccessKeyword = ['成功', '验证', '说明', '证明', '算', '达到'].some(k => r.includes(k));
  return hasNumber && hasSuccessKeyword;
}

function detectExperimentAction(userReply) {
  const r = (userReply || '').toLowerCase();
  // 包含具体行动词
  const actionKeywords = ['找', '问', '访', '测', '试', '做', '打电话', '发消息', '约', '去'];
  const hasAction = actionKeywords.some(k => r.includes(k));
  // 有时间词
  const hasTime = ['天', '周', '月', '明天', '今天', '本周', '这周', '下周'].some(k => r.includes(k));
  return hasAction && (hasTime || r.length >= 15);
}

// ============================================================
// 校验并清理 options（L3 红线）
// ============================================================
function enforceL3Redline(parsed) {
  // 只有 L3 + fact 题才能有 options
  if (parsed.question_kind !== 'fact' && parsed.options && parsed.options.length > 0) {
    parsed.options = [];
  }
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
    const { history, sessionId, endRequested } = req.body; // 【v8】新增 endRequested
    const sid = sessionId || `S${Date.now()}`;

    // 新对话返回开场白
    if (!history || history.length === 0) {
      const opening = getOpeningMessage();
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

    // 更新轮数
    const userMessageCount = history.filter(m => m.role === 'user').length;
    state.total_turns = Math.max(state.total_turns + 1, userMessageCount);

    // 记录原始问题
    if (!state.originalProblem && lastUserMessage) {
      state.originalProblem = lastUserMessage.slice(0, 100);
    }

    // 更新难度（JS 确定性判断）
    updateDifficulty(state, lastUserMessage);

    // 检索相关案例（仅 org 路 Stage 3+）
    let caseHints = [];
    if (state.path === 'org' && state.stage >= 3) {
      if (vectorSearch && (DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY)) {
        try {
          const matches = await vectorSearch.searchSimilarCases(history, { threshold: 0.6, limit: 3 });
          if (matches.length > 0) {
            caseHints = vectorSearch.buildVectorCaseHints(matches);
          }
        } catch (e) {
          // 回退到关键词匹配
        }
      }
      if (caseHints.length === 0) {
        const matchedCases = searchCases(history, state.stage);
        caseHints = buildCaseHints(matchedCases);
      }
    }

    // 【v7】构建系统提示词（无 wrapUpPressure）
    let systemPrompt = buildSystemPrompt(caseHints, state);

    // 添加数据驱动的提示词补丁
    if (promptOptimizer) {
      const patch = promptOptimizer.generatePromptPatch(state);
      if (patch) {
        systemPrompt += patch;
      }
    }

    // 调用 DeepSeek
    const aiContent = await callDeepSeek(systemPrompt, history);

    // 解析响应
    let parsed = parseAIResponse(aiContent);

    // 执行 L3 红线校验
    parsed = enforceL3Redline(parsed);

    // 【v7】从 AI JSON 更新状态
    updateStateFromAIResponse(state, parsed, lastUserMessage);

    // 调试日志
    console.log(`[v8] Turn ${state.total_turns}: path=${state.path}, branch=${state.branch}, layer=${state.cognition_layer}, world_rule=${state.world_rule ? 'yes' : 'no'}, rule_turn_count=${state.rule_turn_count || 0}`);

    // ============================================================
    // 【v8】全路径硬收尾条件（不依赖 AI 的 session_complete）
    // ============================================================
    const reachedWorldRule = !!(state.world_rule && state.world_rule.trim());

    // 1. retrospective 分支：挖到世界规则立即收尾
    const retrospectiveDone = state.branch === 'retrospective' && reachedWorldRule;

    // 2. actionable 分支：挖到 world_rule 后最多再问 1 轮
    const actionableDone = state.branch === 'actionable' && reachedWorldRule && (state.rule_turn_count || 0) >= 1;

    // 3. early 路径：有成功定义 + 有实验行动
    const earlyReady = state.path === 'early' && state.has_success_definition && state.has_experiment_action;

    // 4. early 硬上限
    const earlyCap = state.path === 'early' && state.total_turns >= HARD_CAPS.early;

    // 5. org 硬上限
    const orgCap = state.path === 'org' && state.total_turns >= HARD_CAPS.org;

    // 6. 用户主动请求结束
    const userRequestedEnd = !!endRequested;

    // 综合判定
    const shouldEnd = parsed.session_complete
      || retrospectiveDone
      || actionableDone
      || earlyReady
      || earlyCap
      || orgCap
      || userRequestedEnd;

    // 记录触发原因
    let closeReason = null;
    if (parsed.session_complete) closeReason = 'ai_complete';
    else if (retrospectiveDone) closeReason = 'retrospective_done';
    else if (actionableDone) closeReason = 'actionable_done';
    else if (earlyReady) closeReason = 'early_ready';
    else if (earlyCap) closeReason = 'early_cap';
    else if (orgCap) closeReason = 'org_cap';
    else if (userRequestedEnd) closeReason = 'user_requested';

    if (shouldEnd) {
      console.log(`[v8] Session closing: reason=${closeReason}`);
    }

    // 【v8】服务端兜底收尾语（AI 仍在追问时覆盖 reply）
    let finalReply = parsed.reply;
    if (shouldEnd && !parsed.session_complete) {
      if (retrospectiveDone) {
        finalReply = `谢谢你愿意把这段经历讲到这么深。你刚才说出的那条规则——"${state.world_rule.slice(0, 50)}${state.world_rule.length > 50 ? '...' : ''}"——就是这次对话最珍贵的收获。`;
      } else if (actionableDone) {
        finalReply = `你刚才说出的那条规则——"${state.world_rule.slice(0, 50)}${state.world_rule.length > 50 ? '...' : ''}"——是这次对话最重要的发现。接下来 7 天，你可以设计一个最小实验来验证它。`;
      } else if (earlyReady || earlyCap) {
        finalReply = `很好，你已经有了一个可以在 7 天内验证的实验计划。去执行吧，回来告诉我结果。`;
      } else if (orgCap) {
        finalReply = `我们聊了很多。目前挖到的深度是「${state.deepest_layer_reached || 'result'}」层。你可以带着这些思考，之后再继续探索。`;
      } else if (userRequestedEnd) {
        finalReply = `好的，我们就聊到这里。目前挖到的深度是「${state.deepest_layer_reached || 'result'}」层${state.world_rule ? `，你提到的规则是"${state.world_rule.slice(0, 30)}..."` : ''}。`;
      }
      console.log(`[v8] 服务端兜底：${closeReason}，覆盖 AI 回复`);
    }

    // 构建响应
    const response = {
      reply: finalReply,
      path: state.path,
      branch: state.branch,
      stage: state.stage,
      total_turns: state.total_turns,
      cognition_layer: state.cognition_layer,
      causal_chain: state.causalChain,
      difficulty: state.difficulty,
      question_kind: parsed.question_kind || 'definition',
      options: parsed.options || [],
      curiosity_triggered: state.curiosityTriggered,
      world_rule: state.world_rule,
      redefined_problem: state.redefinedProblem,
      session_hint: parsed.session_hint,
      session_complete: shouldEnd,
      sessionId: sid,
      layer_sequence: state.layer_sequence || []
    };

    // 如果会话完成
    if (shouldEnd) {
      response.discovery_output = parsed.discovery_output || buildDefaultDiscoveryOutput(state, history);
      response.close_reason = closeReason; // 【v8】记录收尾原因

      // 计算深度指标（仅 org 路径）
      if (state.path === 'org' && state.layer_sequence) {
        response.depth_metrics = calculateDepthMetrics(state.layer_sequence);
      }

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
// 构建默认发现输出
// ============================================================
function buildDefaultDiscoveryOutput(state, history = []) {
  const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
  const aiMessages = history.filter(m => m.role === 'assistant').map(m => m.content);

  const originalProblem = state.originalProblem || userMessages[0] || '未记录';

  // 提取实验内容
  const findExperimentContent = () => {
    let experiment = '', criteria = '', hypothesis = '';
    for (const msg of userMessages) {
      if (msg.includes('验证') || msg.includes('测试') || msg.includes('试试') || msg.includes('7天')) {
        experiment = msg.slice(0, 100);
      }
      if ((msg.includes('成功') || msg.includes('说明')) && /\d/.test(msg)) {
        criteria = msg.slice(0, 80);
      }
      if (msg.includes('如果') || msg.includes('假设')) {
        hypothesis = msg.slice(0, 80);
      }
    }
    return { experiment, criteria, hypothesis };
  };

  // 提取错误假设
  const findWrongAssumptions = () => {
    const assumptions = [];
    for (const msg of userMessages) {
      if (msg.includes('原来') || msg.includes('没想到') ||
          msg.includes('我以为') || msg.includes('错了') ||
          msg.includes('不对') || msg.includes('其实')) {
        assumptions.push(msg.slice(0, 80));
      }
    }
    return assumptions.length > 0 ? assumptions.slice(0, 3) : [null];
  };

  // early 路径
  if (state.path === 'early') {
    const exp = findExperimentContent();
    return {
      current_challenge: originalProblem,
      core_assumption: userMessages.find(m => m.includes('我以为') || m.includes('我觉得'))?.slice(0, 80) || null,
      challenged_assumption: userMessages.find(m => m.includes('没想过') || m.includes('原来'))?.slice(0, 80) || null,
      prediction: userMessages.find(m => m.includes('个') && /\d/.test(m))?.slice(0, 80) || null,
      success_definition: userMessages.find(m => (m.includes('成功') || m.includes('验证')) && /\d/.test(m))?.slice(0, 80) || null,
      seven_day_experiment: {
        experiment: exp.experiment || '待设计的最小实验',
        success_criteria: exp.criteria || '成功标准',
        time_horizon: '7天',
        owner: '你'
      }
    };
  }

  // org · retrospective（无实验卡）
  if (state.branch === 'retrospective') {
    const findEarlyWarning = () => {
      for (const msg of userMessages) {
        if (msg.includes('早就') || msg.includes('其实当时') ||
            msg.includes('信号') || msg.includes('迹象') ||
            msg.includes('没注意') || msg.includes('忽视')) {
          return msg.slice(0, 100);
        }
      }
      return null;
    };

    return {
      current_problem: originalProblem,
      causal_chain: state.causalChain?.length > 0 ? state.causalChain : [null],
      wrong_assumptions: findWrongAssumptions(),
      assumption_source: userMessages.find(m =>
        m.includes('来自') || m.includes('因为过去') || m.includes('一直以来')
      )?.slice(0, 100) || null,
      world_rule: state.world_rule || null,
      next_early_signal: findEarlyWarning(),
      is_retrospective: true,
      no_experiment: true
    };
  }

  // org · actionable（有实验卡）
  const exp = findExperimentContent();
  return {
    current_problem: originalProblem,
    causal_chain: state.causalChain?.length > 0 ? state.causalChain : [null],
    wrong_assumptions: findWrongAssumptions(),
    assumption_source: userMessages.find(m =>
      m.includes('来自') || m.includes('因为过去') || m.includes('一直以来')
    )?.slice(0, 100) || null,
    world_rule: state.world_rule || null,
    seven_day_experiment: {
      hypothesis: exp.hypothesis || '待验证的假设',
      experiment: exp.experiment || '本周可执行的最小实验',
      success_criteria: exp.criteria || '成功标准',
      time_horizon: '7天',
      owner: '你'
    }
  };
}

// ============================================================
// 保存会话
// ============================================================
app.post('/api/session/save', async (req, res) => {
  try {
    const { history, discoveryOutput, path, branch, layer_sequence, depth_metrics } = req.body;

    if (!history || history.length === 0) {
      return res.status(400).json({ error: 'No history provided' });
    }

    const sessions = loadSessions();
    const userMessages = history.filter(m => m.role === 'user');

    let finalDepthMetrics = depth_metrics;
    if (path === 'org' && !finalDepthMetrics && layer_sequence) {
      finalDepthMetrics = calculateDepthMetrics(layer_sequence);
    }

    const session = {
      id: `S${Date.now()}`,
      timestamp: new Date().toISOString(),
      surface_problem: userMessages[0]?.content || '',
      initial_explanation: userMessages.length > 1 ? userMessages[1]?.content : '',
      history: history,
      discovery_output: discoveryOutput || null,
      path: path || 'unknown',
      branch: branch || null,
      followup_result: null,
      followup_due: (discoveryOutput?.seven_day_experiment && branch !== 'retrospective') ?
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null,
      depth_metrics: finalDepthMetrics || null
    };

    sessions.push(session);
    saveSessions(sessions);

    await saveSessionToSupabase(session);

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
// 对话深度统计
// ============================================================
app.get('/api/stats/depth', (req, res) => {
  const sessions = loadSessions();

  const orgSessions = sessions.filter(s =>
    s.path === 'org' && s.depth_metrics && s.depth_metrics.max_depth > 0
  );

  const earlySessions = sessions.filter(s => s.path === 'early');
  const earlyWithExperiment = earlySessions.filter(s =>
    s.discovery_output?.seven_day_experiment?.experiment &&
    s.discovery_output.seven_day_experiment.experiment !== '待设计的最小实验'
  );

  if (orgSessions.length === 0) {
    return res.json({
      org: {
        sample_size: 0,
        warning: '样本不足，暂无数据'
      },
      early: {
        sample_size: earlySessions.length,
        qualified_count: earlyWithExperiment.length,
        qualified_rate: earlySessions.length > 0
          ? ((earlyWithExperiment.length / earlySessions.length) * 100).toFixed(1) + '%'
          : '0%'
      }
    });
  }

  const depths = orgSessions.map(s => s.depth_metrics.max_depth);
  const avgDepth = (depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1);

  const brokeAssumptionCount = orgSessions.filter(s => s.depth_metrics.broke_assumption).length;
  const reachedRuleCount = orgSessions.filter(s => s.depth_metrics.reached_rule).length;

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  depths.forEach(d => {
    if (d >= 1 && d <= 6) distribution[d]++;
  });

  const layerNames = {
    1: '结果层', 2: '行为层', 3: '决策层',
    4: '假设层', 5: '环境层', 6: '规则层'
  };

  res.json({
    org: {
      sample_size: orgSessions.length,
      warning: orgSessions.length < 20 ? '样本不足（<20），仅供参考' : null,
      avg_depth: parseFloat(avgDepth),
      avg_depth_label: layerNames[Math.round(parseFloat(avgDepth))] || '',
      broke_assumption_rate: ((brokeAssumptionCount / orgSessions.length) * 100).toFixed(1) + '%',
      reached_rule_rate: ((reachedRuleCount / orgSessions.length) * 100).toFixed(1) + '%',
      depth_distribution: distribution,
      depth_distribution_labels: layerNames
    },
    early: {
      sample_size: earlySessions.length,
      qualified_count: earlyWithExperiment.length,
      qualified_rate: earlySessions.length > 0
        ? ((earlyWithExperiment.length / earlySessions.length) * 100).toFixed(1) + '%'
        : '0%'
    }
  });
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
    version: '8.0-hard-close',
    hasApiKey: !!DEEPSEEK_API_KEY,
    hasSupabase: !!(SUPABASE_URL && SUPABASE_SERVICE_KEY),
    caseLibraryExists: fs.existsSync(CASE_LIBRARY_PATH),
    architecture: 'v8-all-paths-hard-close',
    hard_caps: HARD_CAPS
  });
});

// ============================================================
// 启动服务器
// ============================================================
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('组织镜子 v8 - 全路径硬收尾 + 用户结束按钮');
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

  console.log('\nv8 核心改动:');
  console.log('  - 全路径硬收尾：retrospective/actionable/early/hardCap/userRequest');
  console.log('  - early: 成功定义+实验行动 或 8轮硬上限');
  console.log('  - org: world_rule+1轮 或 18轮硬上限');
  console.log('  - 用户随时可点"结束并生成卡片"');
  console.log(`  - 硬上限: early=${HARD_CAPS.early}轮, org=${HARD_CAPS.org}轮`);

  console.log('\n' + '='.repeat(60));
});
