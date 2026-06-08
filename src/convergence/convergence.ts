/**
 * 收敛边界检查模块
 *
 * 核心原则：检测「客户的认知是否收敛」，不是「问了几个问题」
 */

import { ConvergenceSession, ConvergenceBoundaryResult, StopReason } from './types.js';
import { getCurrentChain, getCurrentDepth } from './session.js';

// 表示用户无法提供更多信息的关键词
const INSUFFICIENT_EVIDENCE_KEYWORDS = [
  '不知道', '不清楚', '没有数据', '不确定', '说不准',
  '没想过', '不太了解', '没法说', '没有具体', '很难说'
];

// 高收敛阈值
const HIGH_CONVERGENCE_THRESHOLD = 0.7;

/**
 * 检查是否达到收敛边界
 *
 * 收敛条件优先级：
 * 1. 【主信号·真收敛】attributionShifted=true 且 emergingHypothesis非空 且 convergenceScore>=0.7
 *    → shouldStop=true, reason="HYPOTHESIS_EMERGED", readyForHypothesis=true
 *
 * 2. 【兜底·仅防啰嗦】questions.length>=3 且未达主信号
 *    → shouldStop=true, reason="DEPTH_LIMIT_REACHED", readyForHypothesis=false
 *    此时不宣称找到假设，进入「试探性反映 + 客户确认」
 *
 * 3. 【证据不足】用户回答表明无法提供更多信息
 *    → 根据已有信息决定是否可以生成假设
 */
export function checkConvergenceBoundary(session: ConvergenceSession): ConvergenceBoundaryResult {
  const currentChain = getCurrentChain(session);
  const currentDepth = getCurrentDepth(session);

  if (!currentChain) {
    return { shouldStop: false, reason: null, readyForHypothesis: false };
  }

  // 获取最新问题的收敛信号
  const latestQuestion = currentChain.questions[currentChain.questions.length - 1];

  // 【主信号·真收敛】检查三个条件同时满足
  if (latestQuestion) {
    const attributionShifted = latestQuestion.attributionShifted === true;
    const hasEmergingHypothesis = !!latestQuestion.emergingHypothesis && latestQuestion.emergingHypothesis.length > 0;
    const highConvergence = (latestQuestion.convergenceScore ?? 0) >= HIGH_CONVERGENCE_THRESHOLD;

    if (attributionShifted && hasEmergingHypothesis && highConvergence) {
      return {
        shouldStop: true,
        reason: 'HYPOTHESIS_EMERGED',
        readyForHypothesis: true
      };
    }
  }

  // 【兜底·仅防啰嗦】达到深度限制但未真正收敛
  if (currentChain.questions.length >= 3) {
    // 检查是否有任何收敛迹象（可以尝试生成反映式假设）
    const hasAnyHypothesis = currentChain.questions.some(q => q.emergingHypothesis && q.emergingHypothesis.length > 0);
    const hasAnyShift = currentChain.questions.some(q => q.attributionShifted === true);

    return {
      shouldStop: true,
      reason: 'DEPTH_LIMIT_REACHED',
      // 如果有一些收敛迹象，可以尝试生成假设让客户确认
      readyForHypothesis: hasAnyHypothesis || hasAnyShift
    };
  }

  return { shouldStop: false, reason: null, readyForHypothesis: false };
}

/**
 * 检查用户最新回答是否表明无法提供更多证据
 */
export function checkInsufficientEvidence(userAnswer: string): boolean {
  const lowerAnswer = userAnswer.toLowerCase();

  for (const keyword of INSUFFICIENT_EVIDENCE_KEYWORDS) {
    if (lowerAnswer.includes(keyword)) {
      return true;
    }
  }

  // 检查回答是否过短（少于10个字符）
  if (userAnswer.trim().length < 10) {
    return true;
  }

  return false;
}

/**
 * 综合判断是否应该停止追问
 */
export function shouldStopQuestioning(
  session: ConvergenceSession,
  latestAnswer?: string
): ConvergenceBoundaryResult {
  // 先检查基本收敛条件
  const basicResult = checkConvergenceBoundary(session);
  if (basicResult.shouldStop) {
    return basicResult;
  }

  // 如果有最新回答，检查是否证据不足
  if (latestAnswer && checkInsufficientEvidence(latestAnswer)) {
    const depth = getCurrentDepth(session);
    // 如果已经有至少2个问题的回答，可以尝试生成假设
    if (depth >= 2) {
      return {
        shouldStop: true,
        reason: 'INSUFFICIENT_EVIDENCE',
        readyForHypothesis: true
      };
    }
  }

  return { shouldStop: false, reason: null, readyForHypothesis: false };
}

/**
 * 计算收敛分数（基于问题链中的信号）
 * 注意：这只是辅助计算，主要收敛分数应来自 AI 的自评
 */
export function calculateConvergenceScore(session: ConvergenceSession): number {
  const chain = getCurrentChain(session);
  if (!chain || chain.questions.length === 0) return 0;

  // 使用最新问题的 convergenceScore
  const latestQuestion = chain.questions[chain.questions.length - 1];
  if (latestQuestion.convergenceScore !== undefined) {
    return latestQuestion.convergenceScore;
  }

  // 如果没有 AI 自评的分数，基于其他信号估算
  let score = 0;

  // 有 emergingHypothesis 加分
  const hasHypothesis = chain.questions.some(q => q.emergingHypothesis && q.emergingHypothesis.length > 0);
  if (hasHypothesis) score += 0.4;

  // 有 attributionShifted 加分
  const hasShift = chain.questions.some(q => q.attributionShifted === true);
  if (hasShift) score += 0.3;

  // 问题数量加分（每个问题 0.1，最多 0.3）
  score += Math.min(0.3, chain.questions.length * 0.1);

  return Math.min(1, score);
}

/**
 * 获取停止原因的中文描述
 */
export function getStopReasonDescription(reason: StopReason): string {
  switch (reason) {
    case 'HYPOTHESIS_EMERGED':
      return '你的想法已经逐渐清晰，现在可以确认一下';
    case 'DEPTH_LIMIT_REACHED':
      return '让我们先整理一下目前聊到的内容';
    case 'VALIDATION_PLAN_READY':
      return '可以开始设计你的验证实验了';
    case 'INSUFFICIENT_EVIDENCE':
      return '基于目前的信息，让我们先试着整理一下';
    case 'USER_CONFIRMED':
      return '你已确认这个假设，接下来设计验证计划';
    default:
      return '继续探讨';
  }
}

/**
 * 判断下一步行动
 */
export function determineNextAction(session: ConvergenceSession, latestAnswer?: string): {
  action: 'CONTINUE_QUESTIONING' | 'GENERATE_REFLECTIVE_HYPOTHESIS' | 'GENERATE_OUTPUT' | 'REQUEST_FOCUS';
  reason: string;
  readyForHypothesis: boolean;
} {
  // 如果还没有选择聚焦问题
  if (!session.selectedProblemFocus) {
    return {
      action: 'REQUEST_FOCUS',
      reason: '等待选择要深入探讨的问题',
      readyForHypothesis: false
    };
  }

  // 如果假设已被客户确认
  if (session.hypothesis?.confirmedByUser) {
    return {
      action: 'GENERATE_OUTPUT',
      reason: '客户已确认假设，生成验证计划',
      readyForHypothesis: true
    };
  }

  // 检查是否应该停止
  const stopResult = shouldStopQuestioning(session, latestAnswer);

  if (stopResult.shouldStop) {
    if (stopResult.readyForHypothesis) {
      return {
        action: 'GENERATE_REFLECTIVE_HYPOTHESIS',
        reason: getStopReasonDescription(stopResult.reason),
        readyForHypothesis: true
      };
    } else {
      // 达到深度限制但没有足够信息，仍尝试生成反映式假设
      return {
        action: 'GENERATE_REFLECTIVE_HYPOTHESIS',
        reason: getStopReasonDescription(stopResult.reason),
        readyForHypothesis: false
      };
    }
  }

  return {
    action: 'CONTINUE_QUESTIONING',
    reason: '继续追问以帮助客户澄清想法',
    readyForHypothesis: false
  };
}
