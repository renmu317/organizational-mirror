/**
 * 组织镜子 v14 - 反映式对话表达
 *
 * v14 核心改动：
 * 1. 姿态转换：从"苏格拉底式审问"变成"并排坐着一起看"
 * 2. 四手法替换连环追问：
 *    - 反映代替追问（主力）：用陈述句把用户的话说回去
 *    - 情境重建+叙事邀请：让用户"回到现场"讲故事
 *    - 并置代替质问矛盾：平静并排摆两句话，让用户自己看见缝隙
 *    - 信念外化：说"那个想法"而非"你的错误假设"
 * 3. 红线：建设性不适感必须还在，别滑成情绪按摩
 * 4. 内核不变：世界模型六层、贝叶斯、撬假设的目标全保留
 *
 * v12.1 延续：
 * - 策略型八步流程（含压力测试）
 * - 收尾条件：has_decision_clarity + has_pressure_test + has_next_step
 * - 新增字段：target_outcome, pressure_test_result
 *
 * v11 延续：
 * - next_gap_hook 字段：闭环后的机会钩（pull 式、虚掩门）
 * - 三条红线：机会钩永远是 pull、闭环优先、去留无条件
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

// 【v9】Admin 配置
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// 【v9】Vision 模型配置
const DEEPSEEK_VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || 'deepseek-chat';

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
        // 【v12.1 fix】只保留 Supabase 表实际存在的列
        history: session.history,
        discovery_output: session.discovery_output,
        path: session.path || 'unknown',
        branch: session.branch || null,
        user_id: session.user_id || null,
        title: session.title || null
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
// 【v8】从 Supabase 读取数据（用于统计）
// ============================================================
async function loadSessionsFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return null;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/sessions?select=*`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });

    if (!response.ok) {
      console.error('[Supabase] 读取会话失败');
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[Supabase] 读取会话错误:', error.message);
    return null;
  }
}

async function loadCasesFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return null;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/cases?select=*`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });

    if (!response.ok) {
      console.error('[Supabase] 读取案例失败');
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[Supabase] 读取案例错误:', error.message);
    return null;
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
// DeepSeek API 调用（v9：支持图片消息）
// ============================================================
async function callDeepSeek(systemPrompt, messages, hasImage = false, retryCount = 0) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  // 【v9】根据是否有图片选择模型
  const model = hasImage ? DEEPSEEK_VISION_MODEL : 'deepseek-chat';

  // 【v14.2 fix】不使用 response_format，改用提示词强制 JSON + 健壮解析
  let finalSystemPrompt = systemPrompt;
  const temperature = retryCount > 0 ? 0.5 : 0.7;

  // 在提示词末尾添加 JSON 强调（所有请求都加）
  finalSystemPrompt += `

【输出要求】你必须只输出一个 JSON 对象，不要有任何其他文字。JSON 必须以 { 开头，以 } 结尾。`;

  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: finalSystemPrompt },
      ...messages
    ],
    temperature: temperature,
    max_tokens: 2000
  };

  // 【v14.2 fix】不使用 response_format（DeepSeek 在多轮对话下不稳定）
  // 改为依赖提示词 + 健壮解析器

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  // 【v14.2 debug】记录 API 响应
  console.log(`[API response] retry=${retryCount}, temp=${temperature}, length: ${content?.length || 0}, preview: ${(content || '').slice(0, 100)}`);

  // 【v14.2 fix】空响应或纯文本响应时重试
  if (!content || content.trim().length === 0 || (!content.includes('{') && retryCount < 1)) {
    if (retryCount < 2) {
      console.log(`[API response] EMPTY or no JSON, retry ${retryCount + 1}/2...`);
      return callDeepSeek(systemPrompt, messages, hasImage, retryCount + 1);
    }
    console.error('[API response] Failed after 2 retries:', (content || '').slice(0, 200));
  }

  return content;
}

// 【v9】检测消息中是否包含图片
function hasImageInMessages(messages) {
  return messages.some(msg => {
    if (Array.isArray(msg.content)) {
      return msg.content.some(c => c.type === 'image_url');
    }
    return false;
  });
}

// 【v9】转换消息格式（处理图片）
function convertMessagesForAPI(messages) {
  return messages.map(msg => {
    // 如果 content 已经是数组格式（包含图片），保持不变
    if (Array.isArray(msg.content)) {
      return msg;
    }
    // 纯文本消息
    return {
      role: msg.role,
      content: msg.content
    };
  });
}

// ============================================================
// 解析 AI 响应
// ============================================================
// 【v14.2】JS 侧路径检测（兜底）
function detectPathFromMessage(userMessage) {
  const msg = (userMessage || '').toLowerCase();

  // strategy 信号词（面向未来决策）
  const strategyKeywords = ['怎么办', '要不要', '该不该', '接下来', '计划', '准备', '周五', '明天', '这周', '下周', 'demo', '方案', '选择', '决定'];
  if (strategyKeywords.some(k => msg.includes(k))) {
    return 'strategy';
  }

  // early 信号词（没有客户/没验证）
  const earlyKeywords = ['没有客户', '还没上线', '想法阶段', '没验证', '没收入', '刚开始', '想做'];
  if (earlyKeywords.some(k => msg.includes(k))) {
    return 'early';
  }

  // org 信号词（面向过去/已有结果）
  const orgKeywords = ['当时', '之前', '已经', '倒闭', '为什么会', '后来', '客户流失', '利润下滑', '失败', '出了问题'];
  if (orgKeywords.some(k => msg.includes(k))) {
    return 'org';
  }

  return null;
}

function parseAIResponse(content, state = null, userMessage = null) {
  // 【v14.2】健壮解析器：尝试多种方式提取 JSON
  const tryParse = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };

  // 1. 直接解析
  let parsed = tryParse(content);
  if (parsed && parsed.reply) return parsed;

  // 2. 提取 {...} 块
  const jsonMatch = (content || '').match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    parsed = tryParse(jsonMatch[0]);
    if (parsed && parsed.reply) return parsed;
  }

  // 3. 尝试修复常见 JSON 错误（末尾多余逗号等）
  if (jsonMatch) {
    const cleaned = jsonMatch[0]
      .replace(/,\s*}/g, '}')  // 移除末尾多余逗号
      .replace(/,\s*]/g, ']'); // 移除数组末尾多余逗号
    parsed = tryParse(cleaned);
    if (parsed && parsed.reply) return parsed;
  }

  // 4. 如果是纯文本回复，构造最小 JSON
  const textContent = (content || '').trim();
  if (textContent && !textContent.startsWith('{')) {
    // 尝试从 state 获取 path，如果 state.path 仍是 unknown，则用 JS 检测
    let detectedPath = state?.path || 'unknown';
    if (detectedPath === 'unknown' && userMessage) {
      const jsPath = detectPathFromMessage(userMessage);
      if (jsPath) {
        detectedPath = jsPath;
        console.log(`[parse] JS path detection: ${jsPath}`);
      }
    }

    console.log('[parse] Treating as plain text reply');
    return {
      reply: textContent,
      path: detectedPath,
      branch: state?.branch || null,
      stage: state?.stage || 1,
      cognition_layer: state?.cognition_layer || 'result',
      world_rule: state?.world_rule || '',
      difficulty: state?.difficulty || 'L1',
      question_kind: 'definition',
      options: [],
      session_complete: false
    };
  }

  console.error('[parse fail] Could not parse, raw:', (content || '').slice(0, 300));
  return createDefaultResponse(content);
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
  early: 8,      // early 硬上限 8 轮
  org: 18,       // org 硬上限 18 轮
  strategy: 16   // 【v14.3】strategy 硬上限改为 16 轮（删除 12 轮无条件收尾）
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
      has_experiment_action: false,  // early: 用户是否给出了实验行动

      // 【v14.3】策略型追踪（增强）
      has_decision_clarity: false,  // 用户是否已想清楚决策
      has_next_step: false,         // 用户是否给出可执行下一步
      has_pressure_test: false,     // 是否完成压力测试
      has_value_evaluation: false,  // 【v14.3】用户是否说出价值/损失/代价
      has_prediction: false,        // 【v14.3】用户是否给出可量化预测
      decision_chain: [],           // 决策链条
      weakest_link: '',             // 最不确定的一环
      hidden_assumption: '',        // 暴露的隐藏假设
      target_outcome: '',           // 想要的结果
      pressure_test_result: ''      // 压力测试结果
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

  // 【v14.3】strategy 路径收尾追踪（增强）
  if (state.path === 'strategy') {
    if (detectDecisionClarity(userReply)) {
      state.has_decision_clarity = true;
    }
    if (detectNextStep(userReply)) {
      state.has_next_step = true;
    }
    if (detectPressureTest(userReply)) {
      state.has_pressure_test = true;
    }
    if (detectValueEvaluation(userReply)) {
      state.has_value_evaluation = true;  // 【v14.3】价值评估
    }
    if (detectPrediction(userReply, parsed)) {
      state.has_prediction = true;  // 【v14.3】预测
    }
    // 提取 AI 返回的字段
    if (parsed.decision_chain) state.decision_chain = parsed.decision_chain;
    if (parsed.weakest_link) state.weakest_link = parsed.weakest_link;
    if (parsed.hidden_assumption) state.hidden_assumption = parsed.hidden_assumption;
    if (parsed.target_outcome) state.target_outcome = parsed.target_outcome;
    if (parsed.pressure_test_result) state.pressure_test_result = parsed.pressure_test_result;
  }

  // 【v11】如果 AI 返回了 next_gap_hook，保存到 state
  if (parsed.next_gap_hook) {
    state.ai_generated_hook = parsed.next_gap_hook;
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
// 【v12】strategy 路径收尾检测
// ============================================================
function detectDecisionClarity(userReply) {
  const r = (userReply || '').toLowerCase();
  // 有具体行动词 + 有对象
  const actionKeywords = ['做', '试', '改', '加', '设计', '准备', '安排', '决定', '选择'];
  const hasAction = actionKeywords.some(k => r.includes(k));
  return hasAction && r.length >= 15;
}

function detectNextStep(userReply) {
  const r = (userReply || '').toLowerCase();
  // 有动词 + 有时间/场景词
  const nextStepKeywords = ['先', '第一步', '接下来', '明天', '周五', '今天', '然后', '首先'];
  return nextStepKeywords.some(k => r.includes(k));
}

// ============================================================
// 【v12.1】压力测试检测
// ============================================================
function detectPressureTest(userReply) {
  const r = (userReply || '').toLowerCase();
  // 用户经历压力测试后的典型回应
  const pressureKeywords = [
    '如果不', '如果错', '那就', '会塌', '会崩', '完了', '没了',
    '确实没想过', '原来', '好像是', '真的会', '可能会失败',
    '风险是', '最坏', '万一', '如果假设错', '假设不成立'
  ];
  return pressureKeywords.some(k => r.includes(k));
}

// ============================================================
// 【v14.3】价值评估检测
// ============================================================
function detectValueEvaluation(userReply) {
  const r = (userReply || '').toLowerCase();
  // 用户说出价值/损失/代价/机会（必须带数值/量化表述）
  const valueKeywords = ['损失', '代价', '机会', '值', '万', '成本', '收益', '价值', '赚', '亏', '省'];
  const hasValueWord = valueKeywords.some(k => r.includes(k));
  // 【v14.3 fix】必须有数字或量化表述，去掉"长度>20"出口
  const hasNumber = /\d/.test(r);
  const hasQuantifier = /[几多少大小高低]/.test(r) || r.includes('倍') || r.includes('半');
  return hasValueWord && (hasNumber || hasQuantifier);
}

// ============================================================
// 【v14.3】预测检测（检查 prediction.object 非空）
// ============================================================
function detectPrediction(userReply, parsed) {
  // 优先检查 AI 返回的 prediction.object
  if (parsed?.prediction?.object) {
    return true;
  }
  // 备用：用户提到具体数量预测
  const r = (userReply || '').toLowerCase();
  const predictionPatterns = [
    /\d+[个人位%]/,           // 3个人、10%
    /\d+.*?(?:转化|成交|签)/,  // 5个转化
    /(?:预测|预计|估计).*?\d/, // 预测有3个
  ];
  return predictionPatterns.some(p => p.test(r));
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
  console.log('[v14.2] /api/respond called, history length:', req.body?.history?.length || 0);
  try {
    const { history, sessionId, userId, endRequested } = req.body; // 【v8】新增 endRequested, 【v9】新增 userId
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

    // 【v9】转换消息格式并检测图片
    const convertedHistory = convertMessagesForAPI(history);
    const hasImage = hasImageInMessages(convertedHistory);

    // 调用 DeepSeek
    const aiContent = await callDeepSeek(systemPrompt, convertedHistory, hasImage);

    // 解析响应（传入 state + 第一条用户消息以便纯文本时检测路径）
    const firstUserMessage = history.find(m => m.role === 'user')?.content || '';
    let parsed = parseAIResponse(aiContent, state, firstUserMessage);
    console.log('[v14.2] parsed path:', parsed.path, 'layer:', parsed.cognition_layer);

    // 执行 L3 红线校验
    parsed = enforceL3Redline(parsed);

    // 【v7】从 AI JSON 更新状态
    updateStateFromAIResponse(state, parsed, lastUserMessage);

    // 调试日志
    console.log(`[v14.2] Turn ${state.total_turns}: path=${state.path}, branch=${state.branch}, layer=${state.cognition_layer}, world_rule=${state.world_rule ? 'yes' : 'no'}`);

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

    // 【v14.3】策略型收尾（加入价值+预测前置）
    const strategyReady = state.path === 'strategy'
      && state.has_pressure_test        // 必须经过压力测试
      && state.has_value_evaluation     // 【v14.3】用户说出损失/代价/机会
      && state.has_prediction           // 【v14.3】用户给出可量化预测
      && state.has_next_step;

    // 【v14.3】16 轮硬兜底（删除 12 轮无条件收尾）
    const strategyCap = state.path === 'strategy'
      && state.total_turns >= HARD_CAPS.strategy;

    // 综合判定
    const shouldEnd = parsed.session_complete
      || retrospectiveDone
      || actionableDone
      || earlyReady
      || earlyCap
      || orgCap
      || strategyReady     // 【v12】新增
      || strategyCap       // 【v12】新增
      || userRequestedEnd;

    // 记录触发原因
    let closeReason = null;
    if (parsed.session_complete) closeReason = 'ai_complete';
    else if (retrospectiveDone) closeReason = 'retrospective_done';
    else if (actionableDone) closeReason = 'actionable_done';
    else if (earlyReady) closeReason = 'early_ready';
    else if (earlyCap) closeReason = 'early_cap';
    else if (orgCap) closeReason = 'org_cap';
    else if (strategyReady) closeReason = 'strategy_ready';    // 【v12】新增
    else if (strategyCap) closeReason = 'strategy_cap';        // 【v12】新增
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
      } else if (strategyReady) {
        // 【v14.3】策略型完整收尾（压力测试+价值+预测都完成）
        finalReply = `你已经把这个决策想清楚了${state.weakest_link ? `：最关键的是"${state.weakest_link}"这一环` : ''}。接下来就去做，做完回来告诉我结果。`;
      } else if (strategyCap) {
        // 【v14.3 fix】16轮兜底但未挖透，诚实收尾
        const hasValue = state.has_value_evaluation;
        const hasPred = state.has_prediction;
        let depth = [];
        if (state.has_pressure_test) depth.push('压力测试');
        if (hasValue) depth.push('价值评估');
        if (hasPred) depth.push('预测');
        const depthStr = depth.length > 0 ? depth.join('、') : '初步梳理';
        const missingStr = (!hasValue || !hasPred) ? '，价值和预测还没深入聊到' : '';
        finalReply = `我们聊了不少，你已经看清了${state.weakest_link ? `"${state.weakest_link}"这个承重点` : '关键环节'}（${depthStr}）${missingStr}。可以带着这些先想想，有需要再继续。`;
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
      // 【v12.1 fix】确保 discovery_output 格式与 path 匹配
      let discoveryOutput = parsed.discovery_output;

      // 如果是 strategy 路径但 AI 返回了 org 格式（有 current_problem 没有 decision），强制用正确格式
      if (state.path === 'strategy' && discoveryOutput && discoveryOutput.current_problem && !discoveryOutput.decision) {
        console.log('[v12.1] strategy 路径但 AI 返回了 org 格式，强制使用 buildDefaultDiscoveryOutput');
        discoveryOutput = null;
      }

      response.discovery_output = discoveryOutput || buildDefaultDiscoveryOutput(state, history, closeReason);
      console.log(`[v12.1] 收尾: path=${state.path}, reason=${closeReason}, discovery_output 字段:`, Object.keys(response.discovery_output));
      response.close_reason = closeReason; // 【v8】记录收尾原因

      // 计算深度指标（仅 org 路径）
      if (state.path === 'org' && state.layer_sequence) {
        response.depth_metrics = calculateDepthMetrics(state.layer_sequence);
      }

      sessionStates.delete(sid);
    }

    // 【v9】实时保存/更新会话到 Supabase（每轮都保存，确保有 user_id）
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && userId) {
      try {
        // 生成会话标题（取第一条用户消息的前20字）
        const firstUserMsg = history.find(m => m.role === 'user')?.content || '';
        const title = firstUserMsg.slice(0, 20) + (firstUserMsg.length > 20 ? '...' : '');

        // 使用 upsert 保存会话
        await fetch(
          `${SUPABASE_URL}/rest/v1/sessions`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
              id: sid,
              user_id: userId,
              title: title,
              path: state.path,
              branch: state.branch,
              transcript: history,
              session_complete: shouldEnd,
              discovery_output: shouldEnd ? response.discovery_output : null,
              created_at: new Date().toISOString()
            })
          }
        );
      } catch (e) {
        console.error('实时保存会话失败:', e.message);
      }
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
function buildDefaultDiscoveryOutput(state, history = [], closeReason = null) {
  const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
  const aiMessages = history.filter(m => m.role === 'assistant').map(m => m.content);

  // 【v14.3 fix】strategyCap 兜底时，未挖到的字段显示"本次未深入"而非 null
  const isStrategyCap = closeReason === 'strategy_cap';

  const originalProblem = state.originalProblem || userMessages[0] || '未记录';

  // 【v11】生成机会钩（仅闭环时）
  // 硬约束：
  // 1. 机会钩永远是 pull、门虚掩（"如果你想..."）
  // 2. 闭环优先于钩子——用户必须能干净离开
  // 3. 去留无条件——位置决定语气，永远不决定去留
  let next_gap_hook = null;

  // 优先使用 AI 生成的 hook
  if (state.ai_generated_hook) {
    next_gap_hook = state.ai_generated_hook;
  } else if (state.world_rule && state.world_rule.trim()) {
    // org 路径：从世界规则反推下一道缝
    if (state.branch === 'retrospective') {
      // 复盘分支：措辞克制（不暗示挽回已倒闭的公司）
      next_gap_hook = `下次创业如果遇到类似处境，你最先想看清的会是什么？`;
    } else {
      // actionable 分支
      const rulePreview = state.world_rule.length > 30
        ? state.world_rule.slice(0, 30) + '...'
        : state.world_rule;
      next_gap_hook = `既然你已经看清"${rulePreview}"——你手上还在用这套老逻辑运转的，还有哪一块？想看的话，下次可以从那里开始。`;
    }
  } else if (state.path === 'early' && state.has_experiment_action) {
    // early 路径：验证完成后
    next_gap_hook = `等你验证完这一轮，如果发现预测和现实不符，那个"不符"里可能藏着下一道值得挖的缝。`;
  }

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

  // 【v14.3】提取可证伪预测（增强：分析 AI 问题 + 用户回答配对）
  const extractPrediction = () => {
    let object = null, if_unchanged = null, if_changed = null, stake = null, verify_window = null;

    // 1. 先从对话配对中提取（更准确）
    for (let i = 0; i < history.length - 1; i++) {
      const aiMsg = history[i];
      const userMsg = history[i + 1];
      if (aiMsg.role !== 'assistant' || userMsg.role !== 'user') continue;

      const aiText = aiMsg.content || '';
      const userText = userMsg.content || '';

      // 预测指标（AI 问"预测多少/几个会..."后的回答）
      if (!object && (aiText.includes('预测') || aiText.includes('几个') || aiText.includes('多少'))) {
        if (/\d/.test(userText)) {
          object = userText.slice(0, 80);
        }
      }

      // 如果不改（AI 问"现在/不改会怎样"后的回答）
      if (!if_unchanged && (aiText.includes('现在') || aiText.includes('不改') || aiText.includes('维持'))) {
        if (/\d/.test(userText) || userText.includes('不') || userText.includes('没')) {
          if_unchanged = userText.slice(0, 80);
        }
      }

      // 如果改变（AI 问"改了会怎样/能有多少"后的回答）
      if (!if_changed && (aiText.includes('改了') || aiText.includes('能有') || aiText.includes('改变后'))) {
        if (/\d/.test(userText) || userText.length > 15) {
          if_changed = userText.slice(0, 80);
        }
      }

      // 价值代价（AI 问"损失/代价/机会/值多少"后的回答）
      if (!stake && (aiText.includes('损失') || aiText.includes('代价') || aiText.includes('机会') || aiText.includes('值'))) {
        if (/\d/.test(userText) || userText.includes('万') || userText.includes('损失') || userText.includes('机会')) {
          stake = userText.slice(0, 80);
        }
      }

      // 验证时间
      if (!verify_window && (aiText.includes('验证') || aiText.includes('时间') || aiText.includes('多久'))) {
        const timeMatch = userText.match(/(周[一二三四五六日天]|明天|后天|今天|\d+天|\d+小时|一周)/);
        if (timeMatch) verify_window = timeMatch[1];
      }
    }

    // 2. 备用：从用户消息关键词提取
    for (const msg of userMessages) {
      // 预测指标
      if (!object) {
        const match = msg.match(/(\d+[个人位%].*?(?:转化|成交|签|付款|约))|(?:转化|成交|签|付款).*?(\d+[个人位%]?)/);
        if (match) object = (match[1] || match[2] || '').slice(0, 80);
      }
      // 如果不改
      if (!if_unchanged && (msg.includes('现在') || msg.includes('不改')) && /\d/.test(msg)) {
        if_unchanged = msg.slice(0, 80);
      }
      // 如果改变
      if (!if_changed && (msg.includes('至少') || msg.includes('能有') || msg.includes('希望')) && /\d/.test(msg)) {
        if_changed = msg.slice(0, 80);
      }
      // 价值代价
      if (!stake && (msg.includes('损失') || msg.includes('机会') || msg.includes('万'))) {
        stake = msg.slice(0, 80);
      }
      // 验证时间
      if (!verify_window) {
        const timeMatch = msg.match(/(周[一二三四五六日天]|明天|后天|今天|\d+天内?|\d+小时|一周)/);
        if (timeMatch) verify_window = timeMatch[1];
      }
    }

    // 只有至少有一个非空字段才返回 prediction
    if (object || if_unchanged || if_changed || stake || verify_window) {
      return {
        object: object || null,
        if_unchanged: if_unchanged || null,
        if_changed: if_changed || null,
        stake: stake || null,
        verify_window: verify_window || null
      };
    }
    return null;
  };

  // 【v14.2】strategy 路径（增强提取逻辑）
  if (state.path === 'strategy') {
    // 【v14.2】智能提取：分析 AI 问题 + 用户回答的配对
    const extractFromHistory = () => {
      let target = null, chain = [], weakest = null, assumption = null, pressure = null, nextStep = null;

      // 遍历对话，找 AI 问题后的用户回答
      for (let i = 0; i < history.length - 1; i++) {
        const aiMsg = history[i];
        const userMsg = history[i + 1];
        if (aiMsg.role !== 'assistant' || userMsg.role !== 'user') continue;

        const aiText = aiMsg.content || '';
        const userText = userMsg.content || '';

        // 1. 提取目标（AI 问"想要什么结果"后的回答）
        if (!target && (aiText.includes('想要') || aiText.includes('结果') || aiText.includes('目标'))) {
          target = userText.slice(0, 150);
        }

        // 2. 提取决策链（AI 问"要经过哪几步"后的回答）
        if (chain.length === 0 && (aiText.includes('几步') || aiText.includes('步骤') || aiText.includes('链条'))) {
          // 尝试拆分用户的步骤描述
          const steps = userText.split(/[，,。；;、→]/).filter(s => s.trim().length > 2);
          if (steps.length >= 2) {
            chain = steps.slice(0, 5).map(s => s.trim().slice(0, 30));
          }
        }

        // 3. 提取承重环（AI 问"哪一环最不确定/没把握"后的回答）
        if (!weakest && (aiText.includes('不确定') || aiText.includes('没把握') || aiText.includes('承重') || aiText.includes('关键'))) {
          weakest = userText.slice(0, 150);
        }

        // 4. 提取假设（AI 问"默认什么是真的"后的回答）
        if (!assumption && (aiText.includes('默认') || aiText.includes('假设') || aiText.includes('没验证'))) {
          assumption = userText.slice(0, 150);
        }

        // 5. 提取压力测试结果（AI 问"如果假设错了会怎样"后的回答）
        if (!pressure && (aiText.includes('如果') && (aiText.includes('错') || aiText.includes('不成立') || aiText.includes('不对')))) {
          pressure = userText.slice(0, 150);
        }

        // 6. 提取下一步（AI 问"接下来先做什么"后的回答）
        if (!nextStep && (aiText.includes('接下来') || aiText.includes('先') || aiText.includes('下一步') || aiText.includes('验证'))) {
          if (userText.length > 10) {
            nextStep = userText.slice(0, 150);
          }
        }
      }

      // 备用：从用户消息关键词提取
      for (const msg of userMessages) {
        if (!target && msg.length > 20 && (msg.includes('想要') || msg.includes('希望') || msg.includes('目标'))) {
          target = msg.slice(0, 150);
        }
        if (!assumption && msg.length > 20 && (msg.includes('以为') || msg.includes('认为') || msg.includes('觉得'))) {
          assumption = msg.slice(0, 150);
        }
        if (!pressure && msg.length > 15 && (msg.includes('如果不') || msg.includes('风险') || msg.includes('失败') || msg.includes('没有'))) {
          pressure = msg.slice(0, 150);
        }
        if (!nextStep && msg.length > 15 && (msg.includes('先') || msg.includes('第一') || msg.includes('接下来') || msg.includes('打算'))) {
          nextStep = msg.slice(0, 150);
        }
      }

      return { target, chain, weakest, assumption, pressure, nextStep };
    };

    const fallback = extractFromHistory();

    // 生成机会钩
    let strategyHook = null;
    const hiddenAssumption = state.hidden_assumption || fallback.assumption;
    if (state.ai_generated_hook) {
      strategyHook = state.ai_generated_hook;
    } else if (hiddenAssumption) {
      strategyHook = `你这个决策想清楚了——而你刚才那条"${hiddenAssumption.slice(0, 20)}..."的假设，可能还卡着你别的决策。想看的话，下次可以一块看。`;
    }

    // 【v14.3 fix】strategyCap 时，未挖到的字段显示"本次未深入"
    const notDeep = isStrategyCap ? '本次未深入' : null;

    // 提取 prediction
    const pred = extractPrediction();
    // 如果是 strategyCap 且 prediction 为空或字段缺失，填充"本次未深入"
    let finalPrediction = pred;
    if (isStrategyCap && (!pred || (!pred.stake && !pred.object))) {
      finalPrediction = {
        object: pred?.object || notDeep,
        if_unchanged: pred?.if_unchanged || notDeep,
        if_changed: pred?.if_changed || notDeep,
        stake: pred?.stake || notDeep,
        verify_window: pred?.verify_window || notDeep
      };
    }

    return {
      decision: state.originalProblem || userMessages[0] || '未记录',
      target_outcome: state.target_outcome || fallback.target || (isStrategyCap ? notDeep : null),
      decision_chain: state.decision_chain?.length > 0 ? state.decision_chain : (fallback.chain.length > 0 ? fallback.chain : null),
      weakest_link: state.weakest_link || fallback.weakest || (isStrategyCap ? notDeep : null),
      hidden_assumption: state.hidden_assumption || fallback.assumption || (isStrategyCap ? notDeep : null),
      pressure_test_result: state.pressure_test_result || fallback.pressure || (isStrategyCap ? notDeep : null),
      next_step: state.next_step || fallback.nextStep || (isStrategyCap ? notDeep : null),
      prediction: finalPrediction,  // 【v12.2】可证伪预测
      next_gap_hook: isStrategyCap ? null : strategyHook  // strategyCap 时不给机会钩（没资格）
    };
  }

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
      },
      next_gap_hook  // 【v11】出口机会钩
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
      no_experiment: true,
      next_gap_hook  // 【v11】出口机会钩
    };
  }

  // org · actionable（有实验卡 + 可证伪预测）
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
    },
    prediction: extractPrediction(),  // 【v12.2】可证伪预测
    next_gap_hook  // 【v11】出口机会钩
  };
}

// ============================================================
// 保存会话
// ============================================================
app.post('/api/session/save', async (req, res) => {
  try {
    const { history, discoveryOutput, path, branch, layer_sequence, depth_metrics, user_id } = req.body;

    if (!history || history.length === 0) {
      return res.status(400).json({ error: 'No history provided' });
    }

    const sessions = loadSessions();
    const userMessages = history.filter(m => m.role === 'user');

    let finalDepthMetrics = depth_metrics;
    if (path === 'org' && !finalDepthMetrics && layer_sequence) {
      finalDepthMetrics = calculateDepthMetrics(layer_sequence);
    }

    // 【v9】生成会话标题（取第一条用户消息前 30 字）
    const title = userMessages[0]?.content?.slice(0, 30) || '新对话';

    const session = {
      id: `S${Date.now()}`,
      timestamp: new Date().toISOString(),
      surface_problem: userMessages[0]?.content || '',
      initial_explanation: userMessages.length > 1 ? userMessages[1]?.content : '',
      history: history,
      discovery_output: discoveryOutput || null,
      path: path || 'unknown',
      branch: branch || null,
      // 【v12.1 fix】删除 followup_due/followup_result，Supabase 表无此列，决策层延后
      depth_metrics: finalDepthMetrics || null,
      user_id: user_id || null,  // 【v9】关联用户
      title: title               // 【v9】会话标题
    };

    sessions.push(session);
    saveSessions(sessions);

    await saveSessionToSupabase(session);

    // 【v9】更新用户的 session_count
    if (user_id && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        // 获取当前用户
        const userResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${user_id}`,
          {
            headers: {
              'apikey': SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
          }
        );
        if (userResponse.ok) {
          const users = await userResponse.json();
          if (users.length > 0) {
            const currentCount = users[0].session_count || 0;
            await fetch(
              `${SUPABASE_URL}/rest/v1/users?id=eq.${user_id}`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': SUPABASE_SERVICE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
                },
                body: JSON.stringify({
                  session_count: currentCount + 1,
                  last_active: new Date().toISOString()
                })
              }
            );
          }
        }
      } catch (e) {
        console.error('[Supabase] 更新用户会话计数失败:', e.message);
      }
    }

    res.json({ success: true, sessionId: session.id });

  } catch (error) {
    console.error('保存会话错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 统计接口（优先从 Supabase 读取）
// ============================================================
app.get('/api/stats', async (req, res) => {
  // 优先从 Supabase 读取
  let cases = await loadCasesFromSupabase();
  if (!cases) {
    cases = loadCaseLibrary();
  }

  const stats = {
    total: cases.length,
    skeleton: cases.filter(c => c.completeness === 'skeleton').length,
    gap: cases.filter(c => c.completeness === 'gap').length,
    enriched: cases.filter(c => c.completeness === 'enriched').length,
    active: cases.filter(c => c.completeness === 'gap' || c.completeness === 'enriched').length,
    highConfidence: cases.filter(c => c.insight_confidence === 'high').length,
    source: cases === loadCaseLibrary() ? 'local' : 'supabase'
  };

  res.json(stats);
});

// ============================================================
// 对话深度统计（优先从 Supabase 读取）
// ============================================================
app.get('/api/stats/depth', async (req, res) => {
  // 优先从 Supabase 读取
  let sessions = await loadSessionsFromSupabase();
  const source = sessions ? 'supabase' : 'local';
  if (!sessions) {
    sessions = loadSessions();
  }

  // 所有 org 路径会话
  const allOrgSessions = sessions.filter(s => s.path === 'org');
  // 有深度数据的 org 会话（用于计算深度统计）
  const orgSessionsWithDepth = sessions.filter(s =>
    s.path === 'org' && s.depth_metrics && s.depth_metrics.max_depth > 0
  );

  const earlySessions = sessions.filter(s => s.path === 'early');

  // 未分类会话（path 为空或 unknown）
  const unclassifiedSessions = sessions.filter(s => !s.path || s.path === 'unknown');
  const earlyWithExperiment = earlySessions.filter(s =>
    s.discovery_output?.seven_day_experiment?.experiment &&
    s.discovery_output.seven_day_experiment.experiment !== '待设计的最小实验'
  );

  const layerNames = {
    1: '结果层', 2: '行为层', 3: '决策层',
    4: '假设层', 5: '环境层', 6: '规则层'
  };

  // 如果没有深度数据，仍返回完整结构
  if (orgSessionsWithDepth.length === 0) {
    return res.json({
      source,
      total_sessions: sessions.length,
      unclassified: unclassifiedSessions.length,
      org: {
        sample_size: 0,
        total_count: allOrgSessions.length,  // 总 org 会话数
        warning: allOrgSessions.length > 0
          ? `有 ${allOrgSessions.length} 场 org 对话，但缺少深度数据（v8 前创建）`
          : '暂无 org 路径对话',
        avg_depth: null,
        avg_depth_label: '',
        broke_assumption_rate: '--',
        reached_rule_rate: '--',
        broke_assumption_count: 0,
        reached_rule_count: 0,
        depth_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
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
  }

  const depths = orgSessionsWithDepth.map(s => s.depth_metrics.max_depth);
  const avgDepth = (depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1);

  const brokeAssumptionCount = orgSessionsWithDepth.filter(s => s.depth_metrics.broke_assumption).length;
  const reachedRuleCount = orgSessionsWithDepth.filter(s => s.depth_metrics.reached_rule).length;

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  depths.forEach(d => {
    if (d >= 1 && d <= 6) distribution[d]++;
  });

  res.json({
    source,
    total_sessions: sessions.length,
    unclassified: unclassifiedSessions.length,
    org: {
      sample_size: orgSessionsWithDepth.length,
      total_count: allOrgSessions.length,
      warning: orgSessionsWithDepth.length < 20 ? '样本不足（<20），仅供参考' : null,
      avg_depth: parseFloat(avgDepth),
      avg_depth_label: layerNames[Math.round(parseFloat(avgDepth))] || '',
      broke_assumption_rate: ((brokeAssumptionCount / orgSessionsWithDepth.length) * 100).toFixed(1) + '%',
      broke_assumption_count: brokeAssumptionCount,
      reached_rule_rate: ((reachedRuleCount / orgSessionsWithDepth.length) * 100).toFixed(1) + '%',
      reached_rule_count: reachedRuleCount,
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
// 【v9】用户管理端点
// ============================================================
app.post('/api/users', async (req, res) => {
  try {
    const { name, company } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const userId = `U${Date.now()}`;

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      // 先查找是否已存在同名用户
      const searchResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/users?name=eq.${encodeURIComponent(name.trim())}&limit=1`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );

      if (searchResponse.ok) {
        const existingUsers = await searchResponse.json();
        if (existingUsers.length > 0) {
          // 更新 last_active
          const existingUser = existingUsers[0];
          await fetch(
            `${SUPABASE_URL}/rest/v1/users?id=eq.${existingUser.id}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
              },
              body: JSON.stringify({ last_active: new Date().toISOString() })
            }
          );
          return res.json({ user: existingUser, isNew: false });
        }
      }

      // 创建新用户
      const createResponse = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          id: userId,
          name: name.trim(),
          company: company?.trim() || null,
          first_seen: new Date().toISOString(),
          session_count: 0,
          last_active: new Date().toISOString()
        })
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        console.error('[Supabase] 创建用户失败:', error);
        return res.status(500).json({ error: 'Failed to create user' });
      }

      const newUsers = await createResponse.json();
      return res.json({ user: newUsers[0], isNew: true });
    }

    // 本地模式
    res.json({
      user: { id: userId, name: name.trim(), company: company?.trim() || null },
      isNew: true
    });

  } catch (error) {
    console.error('创建用户错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 【v9】获取用户会话列表
// ============================================================
app.get('/api/sessions', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/sessions?user_id=eq.${user_id}&select=id,title,created_at,path,session_complete&order=created_at.desc`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('[Supabase] 获取会话列表失败:', error);
        return res.status(500).json({ error: 'Failed to fetch sessions' });
      }

      const sessions = await response.json();
      return res.json({ sessions });
    }

    // 本地模式
    const sessions = loadSessions().filter(s => s.user_id === user_id);
    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        title: s.title || s.surface_problem?.slice(0, 30) || '新对话',
        created_at: s.timestamp,
        path: s.path,
        session_complete: !!s.discovery_output
      }))
    });

  } catch (error) {
    console.error('获取会话列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 【v9】获取单条完整会话
// ============================================================
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/sessions?id=eq.${id}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('[Supabase] 获取会话详情失败:', error);
        return res.status(500).json({ error: 'Failed to fetch session' });
      }

      const sessions = await response.json();
      if (sessions.length === 0) {
        return res.status(404).json({ error: 'Session not found' });
      }

      return res.json({ session: sessions[0] });
    }

    // 本地模式
    const sessions = loadSessions();
    const session = sessions.find(s => s.id === id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });

  } catch (error) {
    console.error('获取会话详情错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 【v9】Admin 密码验证
// ============================================================
app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }

  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }

  res.status(401).json({ error: 'Invalid password' });
});

// ============================================================
// 【v9】获取所有用户列表
// ============================================================
app.get('/api/admin/users', async (req, res) => {
  try {
    // 简单的密码验证（通过 header）
    const authPassword = req.headers['x-admin-password'];
    if (authPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/users?select=*&order=last_active.desc`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('[Supabase] 获取用户列表失败:', error);
        return res.status(500).json({ error: 'Failed to fetch users' });
      }

      const users = await response.json();
      return res.json({ users });
    }

    // 本地模式不支持
    res.json({ users: [] });

  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 【v9】获取用户的所有会话
// ============================================================
app.get('/api/admin/users/:id/sessions', async (req, res) => {
  try {
    const authPassword = req.headers['x-admin-password'];
    if (authPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/sessions?user_id=eq.${id}&select=*&order=created_at.desc`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error('[Supabase] 获取用户会话失败:', error);
        return res.status(500).json({ error: 'Failed to fetch sessions' });
      }

      const sessions = await response.json();
      return res.json({ sessions });
    }

    // 本地模式
    const sessions = loadSessions().filter(s => s.user_id === id);
    res.json({ sessions });

  } catch (error) {
    console.error('获取用户会话错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 【v9】获取用户统计指标
// ============================================================
app.get('/api/admin/users/:id/stats', async (req, res) => {
  try {
    const authPassword = req.headers['x-admin-password'];
    if (authPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    let sessions = [];

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/sessions?user_id=eq.${id}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        }
      );
      if (response.ok) {
        sessions = await response.json();
      }
    } else {
      sessions = loadSessions().filter(s => s.user_id === id);
    }

    // 计算统计指标
    const total = sessions.length;
    const completed = sessions.filter(s => s.session_complete).length;
    const orgSessions = sessions.filter(s => s.path === 'org');
    const earlySessions = sessions.filter(s => s.path === 'early');

    // 深度统计（org 路径）
    const orgWithDepth = orgSessions.filter(s => s.depth_metrics && s.depth_metrics.max_depth > 0);
    const avgDepth = orgWithDepth.length > 0
      ? (orgWithDepth.reduce((sum, s) => sum + s.depth_metrics.max_depth, 0) / orgWithDepth.length).toFixed(1)
      : null;
    const brokeAssumption = orgWithDepth.filter(s => s.depth_metrics.broke_assumption).length;
    const reachedRule = orgWithDepth.filter(s => s.depth_metrics.reached_rule).length;
    const hasWorldRule = sessions.filter(s => s.world_rule).length;

    res.json({
      total_sessions: total,
      completed_sessions: completed,
      completion_rate: total > 0 ? ((completed / total) * 100).toFixed(0) + '%' : '0%',
      org_sessions: orgSessions.length,
      early_sessions: earlySessions.length,
      avg_depth: avgDepth ? parseFloat(avgDepth) : null,
      broke_assumption_count: brokeAssumption,
      broke_assumption_rate: orgWithDepth.length > 0 ? ((brokeAssumption / orgWithDepth.length) * 100).toFixed(0) + '%' : null,
      reached_rule_count: reachedRule,
      reached_rule_rate: orgWithDepth.length > 0 ? ((reachedRule / orgWithDepth.length) * 100).toFixed(0) + '%' : null,
      world_rule_count: hasWorldRule
    });

  } catch (error) {
    console.error('获取用户统计错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// 健康检查
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '14.3-strategy-10step',
    hasApiKey: !!DEEPSEEK_API_KEY,
    hasSupabase: !!(SUPABASE_URL && SUPABASE_SERVICE_KEY),
    caseLibraryExists: fs.existsSync(CASE_LIBRARY_PATH),
    architecture: 'v14-reflective-dialogue',
    hard_caps: HARD_CAPS
  });
});

// ============================================================
// 启动服务器
// ============================================================
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('组织镜子 v14.3 - 策略型十步流程');
  console.log('='.repeat(60));
  console.log(`\n访问地址: http://localhost:${PORT}\n`);
  console.log(`后台地址: http://localhost:${PORT}/admin.html\n`);

  if (!DEEPSEEK_API_KEY) {
    console.log('⚠️  警告: DEEPSEEK_API_KEY 未配置');
    console.log('   请复制 .env.example 为 .env 并填入 API Key\n');
  }

  if (!ADMIN_PASSWORD) {
    console.log('⚠️  警告: ADMIN_PASSWORD 未配置');
  }

  const cases = loadCaseLibrary();
  if (cases.length > 0) {
    const active = cases.filter(c =>
      c.completeness === 'gap' || c.completeness === 'enriched'
    ).length;
    console.log(`案例库状态: ${active} 条活跃案例 / ${cases.length} 条总计`);
  }

  console.log('\nv14.2 核心变化:');
  console.log('  1. 移除 response_format（DeepSeek 多轮对话不稳定）');
  console.log('  2. 健壮解析器：支持纯文本/混合输出回退');
  console.log('  3. 纯文本时保留 state 中的路径信息');
  console.log(`  - 硬上限: early=${HARD_CAPS.early}轮, strategy=${HARD_CAPS.strategy}轮, org=${HARD_CAPS.org}轮`);

  console.log('\n' + '='.repeat(60));
});
