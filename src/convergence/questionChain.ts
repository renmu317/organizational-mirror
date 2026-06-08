/**
 * 问题链模块
 *
 * 负责生成追问问题，调用 DeepSeek API，记录收敛信号
 */

import { ConvergenceSession, CaseEntry, QuestionDepth, GeneratedQuestion, QuestionRecord } from './types.js';
import { getCurrentChain, getCurrentDepth, addQuestionRecord, addExtractedAssumption, addEmergingInsight, updateConvergenceScore } from './session.js';
import { buildQuestionPrompt, buildSymptomAnalysisPrompt, buildReflectiveHypothesisPrompt } from './prompts.js';

// DeepSeek API 配置
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * 调用 DeepSeek API
 */
async function callDeepSeek(prompt: string, apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 600
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

/**
 * 解析 AI 响应为 JSON
 */
function parseJsonResponse<T>(content: string): T | null {
  try {
    return JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        console.error('Failed to parse JSON from response:', content);
        return null;
      }
    }
    return null;
  }
}

/**
 * 分析症状并识别主要问题
 */
export async function analyzeSymptoms(
  symptoms: string[],
  apiKey: string
): Promise<{
  primarySymptom: string;
  secondarySymptoms: string[];
  suggestedFocus: string;
}> {
  const prompt = buildSymptomAnalysisPrompt(symptoms);
  const response = await callDeepSeek(prompt, apiKey);
  const parsed = parseJsonResponse<{
    primarySymptom: string;
    secondarySymptoms: string[];
    suggestedFocus: string;
    analysisNote?: string;
  }>(response);

  if (!parsed) {
    return {
      primarySymptom: symptoms[0] || '',
      secondarySymptoms: symptoms.slice(1),
      suggestedFocus: symptoms[0] || ''
    };
  }

  return {
    primarySymptom: parsed.primarySymptom,
    secondarySymptoms: parsed.secondarySymptoms || [],
    suggestedFocus: parsed.suggestedFocus
  };
}

/**
 * 生成下一个问题（含收敛信号）
 */
export async function generateNextQuestion(
  session: ConvergenceSession,
  matchedCases: CaseEntry[],
  apiKey: string
): Promise<GeneratedQuestion> {
  const currentDepth = getCurrentDepth(session);
  const nextDepth = Math.min(3, currentDepth + 1) as QuestionDepth;

  const prompt = buildQuestionPrompt(session, matchedCases, nextDepth);
  const response = await callDeepSeek(prompt, apiKey);
  const parsed = parseJsonResponse<GeneratedQuestion>(response);

  if (!parsed) {
    // 默认问题（无收敛信号）
    const defaultQuestions: Record<QuestionDepth, string> = {
      1: '为什么你认为这是核心问题？你是基于什么判断的？',
      2: '你能给我一个具体的数字或事件来支持这个判断吗？',
      3: '如果这个问题明天解决了，你的业务就一定会改善吗？'
    };

    return {
      question: defaultQuestions[nextDepth],
      depth: nextDepth,
      targetAssumption: '',
      convergenceHint: '',
      attributionShifted: false,
      emergingHypothesis: '',
      convergenceScore: 0.3
    };
  }

  return {
    question: parsed.question,
    depth: nextDepth,
    targetAssumption: parsed.targetAssumption || '',
    convergenceHint: parsed.convergenceHint || '',
    attributionShifted: parsed.attributionShifted ?? false,
    emergingHypothesis: parsed.emergingHypothesis || '',
    convergenceScore: parsed.convergenceScore ?? 0.3
  };
}

/**
 * 处理用户回答并更新会话
 * 返回是否应该继续提问
 */
export async function processAnswer(
  session: ConvergenceSession,
  userAnswer: string,
  matchedCases: CaseEntry[],
  apiKey: string
): Promise<{
  session: ConvergenceSession;
  nextQuestion: GeneratedQuestion | null;
  shouldStop: boolean;
  readyForHypothesis: boolean;
}> {
  const chain = getCurrentChain(session);
  if (!chain) {
    throw new Error('No active question chain');
  }

  // 获取最后一个问题（用户正在回答的问题）
  const lastQuestionIndex = chain.questions.length - 1;
  const lastQuestion = chain.questions[lastQuestionIndex];

  if (!lastQuestion) {
    throw new Error('No question to answer');
  }

  // 更新问题的回答
  lastQuestion.userAnswer = userAnswer;

  // 检查是否达到深度限制
  const currentDepth = chain.questions.length;
  if (currentDepth >= 3) {
    return {
      session,
      nextQuestion: null,
      shouldStop: true,
      readyForHypothesis: true
    };
  }

  // 生成下一个问题（AI会同时自评收敛信号）
  const nextQuestion = await generateNextQuestion(session, matchedCases, apiKey);

  // 记录收敛信号到会话
  if (nextQuestion.emergingHypothesis) {
    addEmergingInsight(session, nextQuestion.emergingHypothesis);
  }

  // 更新收敛分数
  updateConvergenceScore(session, nextQuestion.convergenceScore);

  // 检查是否已收敛
  const isConverged = nextQuestion.attributionShifted &&
                      nextQuestion.emergingHypothesis.length > 0 &&
                      nextQuestion.convergenceScore >= 0.7;

  if (isConverged) {
    return {
      session,
      nextQuestion,
      shouldStop: true,
      readyForHypothesis: true
    };
  }

  // 添加新问题到链中（回答为空，等待用户）
  addQuestionRecord(session, {
    depth: nextQuestion.depth,
    question: nextQuestion.question,
    userAnswer: '',
    targetAssumption: nextQuestion.targetAssumption,
    attributionShifted: nextQuestion.attributionShifted,
    emergingHypothesis: nextQuestion.emergingHypothesis,
    convergenceScore: nextQuestion.convergenceScore
  });

  return {
    session,
    nextQuestion,
    shouldStop: false,
    readyForHypothesis: false
  };
}

/**
 * 生成反映式假设（让客户确认）
 */
export async function generateReflectiveHypothesis(
  session: ConvergenceSession,
  apiKey: string
): Promise<{
  reflectiveStatement: string;
  userPhrasing: string;
  observableEvidence: string[];
}> {
  const prompt = buildReflectiveHypothesisPrompt(session);
  const response = await callDeepSeek(prompt, apiKey);
  const parsed = parseJsonResponse<{
    reflectiveStatement: string;
    userPhrasing: string;
    observableEvidence: string[];
  }>(response);

  if (!parsed) {
    // 基于会话信息构建默认反映式假设
    const chain = getCurrentChain(session);
    const extractedAssumptions = chain?.extractedAssumptions || [];
    const userPhrasing = extractedAssumptions[0] || session.selectedProblemFocus;

    return {
      reflectiveStatement: `照你刚才说的——「${userPhrasing}」——听起来你现在的想法是这个方向可能需要更多关注。我理解得对吗？`,
      userPhrasing,
      observableEvidence: ['需要进一步观察的指标']
    };
  }

  return parsed;
}

/**
 * 获取第一个问题（开始问题链时使用）
 */
export async function generateFirstQuestion(
  session: ConvergenceSession,
  matchedCases: CaseEntry[],
  apiKey: string
): Promise<string> {
  const question = await generateNextQuestion(session, matchedCases, apiKey);

  // 将第一个问题添加到链中
  addQuestionRecord(session, {
    depth: 1,
    question: question.question,
    userAnswer: '',
    targetAssumption: question.targetAssumption,
    attributionShifted: question.attributionShifted,
    emergingHypothesis: question.emergingHypothesis,
    convergenceScore: question.convergenceScore
  });

  return question.question;
}

// ============================================================
// 兼容旧函数名（逐步废弃）
// ============================================================

/** @deprecated 使用 processAnswer */
export async function processAnswerAndGenerateNext(
  session: ConvergenceSession,
  userAnswer: string,
  matchedCases: CaseEntry[],
  apiKey: string
): Promise<{
  session: ConvergenceSession;
  nextQuestion: GeneratedQuestion | null;
  shouldStop: boolean;
}> {
  const result = await processAnswer(session, userAnswer, matchedCases, apiKey);
  return {
    session: result.session,
    nextQuestion: result.nextQuestion,
    shouldStop: result.shouldStop
  };
}
