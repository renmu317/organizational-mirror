/**
 * 假设生成模块
 *
 * 核心原则：假设归客户所有，不是 AI 下结论
 * 输出的 statement 必须是「反映句」，以提问结尾
 */

import { ConvergenceSession, CaseEntry, Hypothesis } from './types.js';
import { getCurrentChain, setHypothesis } from './session.js';
import { buildReflectiveHypothesisPrompt, buildValidationPlanPrompt } from './prompts.js';

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
      max_tokens: 800
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
 * 生成反映式假设（待客户确认）
 *
 * 输出的 statement 格式：
 * 「照你刚才说的——『（引用客户原话）』——听起来你现在的想法是……我理解得对吗？」
 */
export async function generateReflectiveHypothesis(
  session: ConvergenceSession,
  matchedCases: CaseEntry[],
  apiKey: string
): Promise<Hypothesis> {
  const prompt = buildReflectiveHypothesisPrompt(session);
  const response = await callDeepSeek(prompt, apiKey);
  const parsed = parseJsonResponse<{
    reflectiveStatement: string;
    userPhrasing: string;
    observableEvidence: string[];
  }>(response);

  if (!parsed) {
    // 基于会话信息构建默认反映式假设
    return buildDefaultReflectiveHypothesis(session, matchedCases);
  }

  return {
    statement: parsed.reflectiveStatement,
    userPhrasing: parsed.userPhrasing,
    confirmedByUser: false,
    observableEvidence: parsed.observableEvidence || [],
    verificationMethod: '观察并记录上述指标的变化',
    verificationPeriodDays: 7
  };
}

/**
 * 构建默认反映式假设（当 AI 解析失败时使用）
 */
function buildDefaultReflectiveHypothesis(
  session: ConvergenceSession,
  matchedCases: CaseEntry[]
): Hypothesis {
  const chain = getCurrentChain(session);
  const extractedAssumptions = chain?.extractedAssumptions || [];

  // 找到客户说过的关键原话
  let userPhrasing = extractedAssumptions[0] || '';

  // 如果没有提取到假设，从问答中找
  if (!userPhrasing && chain && chain.questions.length > 0) {
    // 找最后一个有回答的问题
    const lastAnswered = chain.questions.filter(q => q.userAnswer).pop();
    if (lastAnswered) {
      // 截取回答的关键部分
      userPhrasing = lastAnswered.userAnswer.slice(0, 50);
      if (lastAnswered.userAnswer.length > 50) {
        userPhrasing += '……';
      }
    }
  }

  // 如果还是没有，使用聚焦问题
  if (!userPhrasing) {
    userPhrasing = session.selectedProblemFocus;
  }

  // 构建反映式陈述（必须以提问结尾）
  const statement = `照你刚才说的——「${userPhrasing}」——听起来你现在的想法是，这个方向值得进一步验证。我理解得对吗？`;

  // 构建可观测证据
  const observableEvidence: string[] = [
    '关键决策从提出到执行的时间',
    '团队成员对问题根源的看法是否一致',
    '最近30天内类似问题出现的频率'
  ];

  return {
    statement,
    userPhrasing,
    confirmedByUser: false,
    observableEvidence,
    verificationMethod: '每天记录上述指标，对比变化趋势',
    verificationPeriodDays: 7
  };
}

/**
 * 客户确认或修正假设
 */
export function processHypothesisConfirmation(
  session: ConvergenceSession,
  confirmed: boolean,
  modification?: string
): {
  session: ConvergenceSession;
  needsContinue: boolean;
} {
  if (!session.hypothesis) {
    return { session, needsContinue: true };
  }

  if (confirmed) {
    // 客户确认
    session.hypothesis.confirmedByUser = true;
    session.stopReason = 'USER_CONFIRMED';
    return { session, needsContinue: false };
  }

  if (modification) {
    // 客户提供修正，更新假设
    session.hypothesis.statement = `照你刚才说的——「${modification}」——这是你想要验证的方向。对吗？`;
    session.hypothesis.userPhrasing = modification;
    session.hypothesis.confirmedByUser = false;
    // 需要再次确认
    return { session, needsContinue: true };
  }

  // 客户否定但没有修正，继续追问
  return { session, needsContinue: true };
}

/**
 * 评估假设质量（确保符合反映式要求）
 */
export function evaluateHypothesisQuality(hypothesis: Hypothesis): {
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 100;

  // 检查是否是反映式（必须以提问结尾）
  const questionPatterns = ['吗？', '呢？', '对吗？', '是吗？'];
  const endsWithQuestion = questionPatterns.some(p => hypothesis.statement.endsWith(p));
  if (!endsWithQuestion) {
    issues.push('假设陈述必须以提问结尾');
    score -= 30;
  }

  // 检查是否包含禁止的断言式表达
  const forbiddenPatterns = ['核心原因是', '真正问题是', '你的问题是', '根本原因是'];
  forbiddenPatterns.forEach(p => {
    if (hypothesis.statement.includes(p)) {
      issues.push(`假设陈述包含禁止的断言式表达：「${p}」`);
      score -= 25;
    }
  });

  // 检查是否引用了客户原话
  if (!hypothesis.userPhrasing || hypothesis.userPhrasing.length < 5) {
    issues.push('缺少客户原话引用');
    score -= 20;
  }

  // 检查可观测证据
  if (!hypothesis.observableEvidence || hypothesis.observableEvidence.length < 2) {
    issues.push('可观测证据不足');
    score -= 15;
  }

  return {
    score: Math.max(0, score),
    issues
  };
}

/**
 * 优化假设（如果质量评分低）
 */
export async function refineHypothesis(
  hypothesis: Hypothesis,
  session: ConvergenceSession,
  apiKey: string
): Promise<Hypothesis> {
  const evaluation = evaluateHypothesisQuality(hypothesis);

  // 如果质量足够好，直接返回
  if (evaluation.score >= 70) {
    return hypothesis;
  }

  // 修正不符合要求的假设
  let refinedStatement = hypothesis.statement;

  // 确保以提问结尾
  if (!refinedStatement.endsWith('？')) {
    refinedStatement = refinedStatement.replace(/[。！]$/, '') + '，我理解得对吗？';
  }

  // 移除断言式表达
  const forbiddenPatterns = ['核心原因是', '真正问题是', '你的问题是', '根本原因是'];
  forbiddenPatterns.forEach(p => {
    refinedStatement = refinedStatement.replace(p, '你提到的');
  });

  return {
    ...hypothesis,
    statement: refinedStatement
  };
}

// ============================================================
// 兼容旧函数（逐步废弃）
// ============================================================

/** @deprecated 使用 generateReflectiveHypothesis */
export const generateHypothesis = generateReflectiveHypothesis;
