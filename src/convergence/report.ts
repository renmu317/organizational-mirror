/**
 * 收敛总结生成模块
 *
 * 核心原则：这是给客户自己看的「你的假设与实验」，不是诊断报告
 * 全程用「你」，不用「客户」「用户」
 * 所有判断必须可回溯到客户自己说的话
 */

import { ConvergenceSession, ConvergenceOutput, Hypothesis, ValidationPlan } from './types.js';
import { getCurrentChain } from './session.js';
import { buildSummaryPrompt } from './prompts.js';
import { formatValidationPlanAsText, calculateCompletionDate } from './validation.js';
import { getStopReasonDescription } from './convergence.js';

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
 * 生成收敛总结（客户视角）
 */
export async function generateConvergenceSummary(
  session: ConvergenceSession,
  apiKey: string
): Promise<string> {
  const prompt = buildSummaryPrompt(session);

  try {
    const summary = await callDeepSeek(prompt, apiKey);
    return summary;
  } catch (error) {
    console.error('Failed to generate summary via AI:', error);
    // 如果 AI 生成失败，使用模板生成
    return generateTemplateSummary(session);
  }
}

/**
 * 使用模板生成总结（当 AI 生成失败时使用）
 * 注意：全程用「你」，客户视角
 */
function generateTemplateSummary(session: ConvergenceSession): string {
  const chain = getCurrentChain(session);
  const dates = calculateCompletionDate();

  let summary = `# 你的假设与实验\n\n`;
  summary += `**会话ID**: ${session.sessionId}\n`;
  summary += `**时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;

  summary += `## 1. 你最初提到的问题\n\n`;
  summary += `**主要关注点**: ${session.primarySymptom}\n\n`;
  if (session.secondarySymptoms.length > 0) {
    summary += `**同时提到的**: ${session.secondarySymptoms.join('、')}\n\n`;
  }
  summary += `**你选择深入探讨的方向**: ${session.selectedProblemFocus}\n\n`;

  summary += `## 2. 对话中的关键转变\n\n`;
  if (chain && chain.questions.length > 0) {
    chain.questions.forEach((q, i) => {
      if (q.userAnswer) {
        summary += `### 第${q.depth}层追问\n`;
        summary += `**问**: ${q.question}\n\n`;
        summary += `**你说**: ${q.userAnswer}\n\n`;
        if (q.emergingHypothesis) {
          summary += `*（你开始逼近的想法：${q.emergingHypothesis}）*\n\n`;
        }
      }
    });
  } else {
    summary += `*暂无问答记录*\n\n`;
  }

  summary += `## 3. 对话中浮现的新看法\n\n`;
  if (session.emergingInsights.length > 0) {
    session.emergingInsights.forEach((e, i) => {
      summary += `${i + 1}. ${e}\n`;
    });
  } else {
    summary += `*对话中暂未浮现明确的新看法*\n`;
  }
  summary += '\n';

  if (session.hypothesis) {
    summary += `## 4. 你决定验证的假设\n\n`;
    summary += `${session.hypothesis.statement}\n\n`;

    if (session.hypothesis.userPhrasing) {
      summary += `**你自己说的原话**: 「${session.hypothesis.userPhrasing}」\n\n`;
    }

    summary += `**可观测的证据**:\n`;
    session.hypothesis.observableEvidence.forEach((e, i) => {
      summary += `- ${e}\n`;
    });
    summary += '\n';

    summary += `**验证方法**: ${session.hypothesis.verificationMethod}\n\n`;
  }

  if (session.sevenDayValidationPlan) {
    summary += `## 5. 接下来7天的行动\n\n`;
    summary += `**开始日期**: ${dates.day1}\n`;
    summary += `**结束日期**: ${dates.day7}\n\n`;
    summary += formatValidationPlanAsText(session.sevenDayValidationPlan);
  }

  summary += `\n## 6. 下一步\n\n`;
  summary += `1. 从今天开始执行7天验证计划\n`;
  summary += `2. 每天花10分钟记录你的观察\n`;
  summary += `3. 第7天复盘，看看假设是否被验证\n`;
  summary += `4. 基于验证结果，决定下一步怎么做\n`;

  return summary;
}

/**
 * 生成完整的收敛输出
 */
export function generateConvergenceOutput(session: ConvergenceSession): ConvergenceOutput | null {
  if (!session.hypothesis || !session.sevenDayValidationPlan) {
    return null;
  }

  const chain = getCurrentChain(session);

  return {
    primarySymptom: session.primarySymptom,
    selectedProblemFocus: session.selectedProblemFocus,
    originalProblemDefinition: `${session.primarySymptom}${session.secondarySymptoms.length > 0 ? '，以及' + session.secondarySymptoms.join('、') : ''}`,
    questionChains: session.questionChains,
    emergingInsights: session.emergingInsights,
    hypothesis: session.hypothesis,
    stopReason: session.stopReason,
    sevenDayValidationPlan: session.sevenDayValidationPlan,
    convergenceSummary: session.convergenceSummary || ''
  };
}

/**
 * 生成简洁摘要（用于快速预览）
 */
export function generateBriefSummary(session: ConvergenceSession): string {
  const chain = getCurrentChain(session);
  const questionCount = chain?.questions.filter(q => q.userAnswer).length || 0;

  let summary = `【会话摘要】\n`;
  summary += `- 聚焦方向: ${session.selectedProblemFocus}\n`;
  summary += `- 完成追问: ${questionCount} 层\n`;
  summary += `- 收敛进度: ${session.convergenceProgress}%\n`;

  if (session.stopReason) {
    summary += `- 停止原因: ${getStopReasonDescription(session.stopReason)}\n`;
  }

  if (session.hypothesis) {
    summary += `\n【你的假设】\n${session.hypothesis.statement}\n`;
    if (session.hypothesis.confirmedByUser) {
      summary += `✓ 你已确认这个假设\n`;
    }
  }

  if (session.emergingInsights.length > 0) {
    summary += `\n【对话中浮现的看法】\n`;
    session.emergingInsights.slice(0, 3).forEach((e, i) => {
      summary += `${i + 1}. ${e}\n`;
    });
  }

  return summary;
}

/**
 * 导出收敛结果为 JSON
 */
export function exportConvergenceAsJson(session: ConvergenceSession): string {
  const output = generateConvergenceOutput(session);
  if (!output) {
    return JSON.stringify({
      error: 'Convergence not complete',
      session: {
        sessionId: session.sessionId,
        status: 'incomplete',
        convergenceProgress: session.convergenceProgress
      }
    }, null, 2);
  }

  return JSON.stringify(output, null, 2);
}

/**
 * 生成分享文本（用于发送给他人）
 */
export function generateShareableText(session: ConvergenceSession): string {
  if (!session.hypothesis) {
    return '对话尚未完成';
  }

  let text = `📋 我的假设与实验\n\n`;
  text += `🎯 聚焦方向: ${session.selectedProblemFocus}\n\n`;
  text += `💡 我的假设:\n${session.hypothesis.statement}\n\n`;

  if (session.sevenDayValidationPlan) {
    text += `📅 7天验证计划已生成\n`;
    text += `✅ 成功标准: ${session.sevenDayValidationPlan.successCriteria}\n`;
  }

  return text;
}

// ============================================================
// 兼容旧函数名（逐步废弃）
// ============================================================

/** @deprecated 使用 generateConvergenceSummary */
export const generateDiagnosticReport = generateConvergenceSummary;

/** @deprecated 使用 generateConvergenceOutput */
export const generateDiagnosticOutput = generateConvergenceOutput;

/** @deprecated 使用 generateBriefSummary */
export const generateSummary = generateBriefSummary;

/** @deprecated 使用 exportConvergenceAsJson */
export const exportDiagnosisAsJson = exportConvergenceAsJson;
