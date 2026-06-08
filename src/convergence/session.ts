/**
 * 收敛会话管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConvergenceSession, QuestionChain, QuestionRecord } from './types.js';

// 会话存储路径
const CONVERGE_SESSIONS_PATH = path.join(__dirname, '../../data/convergeSessions.json');

/**
 * 生成唯一会话ID
 */
export function generateSessionId(): string {
  return `CONV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 生成唯一问题链ID
 */
export function generateChainId(): string {
  return `CHAIN-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * 创建新的收敛会话
 */
export function createSession(
  primarySymptom: string,
  secondarySymptoms: string[],
  suggestedFocus: string
): ConvergenceSession {
  const session: ConvergenceSession = {
    sessionId: generateSessionId(),
    createdAt: new Date().toISOString(),

    // Rule 1: 问题聚焦
    primarySymptom,
    secondarySymptoms,
    selectedProblemFocus: '', // 等待用户选择

    // Rule 2: 问题链
    questionChains: [],
    currentChainId: null,

    // Rule 3: 客户浮现的看法
    emergingInsights: [],

    // Rule 4: 停止条件
    stopReason: null,

    // 输出
    hypothesis: null,
    sevenDayValidationPlan: null,
    convergenceSummary: null,

    // 元数据
    matchedCaseIds: [],
    totalQuestions: 0,
    convergenceProgress: 0
  };

  return session;
}

/**
 * 加载所有收敛会话
 */
export function loadConvergeSessions(): ConvergenceSession[] {
  try {
    if (fs.existsSync(CONVERGE_SESSIONS_PATH)) {
      const data = fs.readFileSync(CONVERGE_SESSIONS_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('加载收敛会话失败:', error);
  }
  return [];
}

/**
 * 保存所有收敛会话
 */
export function saveConvergeSessions(sessions: ConvergenceSession[]): boolean {
  try {
    fs.writeFileSync(CONVERGE_SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存收敛会话失败:', error);
    return false;
  }
}

/**
 * 通过ID获取会话
 */
export function getSessionById(sessionId: string): ConvergenceSession | null {
  const sessions = loadConvergeSessions();
  return sessions.find(s => s.sessionId === sessionId) || null;
}

/**
 * 更新会话
 */
export function updateSession(session: ConvergenceSession): boolean {
  const sessions = loadConvergeSessions();
  const index = sessions.findIndex(s => s.sessionId === session.sessionId);

  if (index === -1) {
    // 新会话，添加到列表
    sessions.push(session);
  } else {
    // 更新现有会话
    sessions[index] = session;
  }

  return saveConvergeSessions(sessions);
}

/**
 * 获取当前问题链
 */
export function getCurrentChain(session: ConvergenceSession): QuestionChain | null {
  if (!session.currentChainId) return null;
  return session.questionChains.find(c => c.chainId === session.currentChainId) || null;
}

/**
 * 创建新的问题链
 */
export function createQuestionChain(targetSymptom: string): QuestionChain {
  return {
    chainId: generateChainId(),
    targetSymptom,
    questions: [],
    convergenceScore: 0,
    extractedAssumptions: []
  };
}

/**
 * 开始新的问题链
 */
export function startNewChain(session: ConvergenceSession, targetSymptom: string): ConvergenceSession {
  const chain = createQuestionChain(targetSymptom);
  session.questionChains.push(chain);
  session.currentChainId = chain.chainId;
  return session;
}

/**
 * 计算当前问题链的深度
 */
export function getCurrentDepth(session: ConvergenceSession): number {
  const chain = getCurrentChain(session);
  if (!chain) return 0;
  return chain.questions.length;
}

/**
 * 添加问题记录到当前链（含收敛信号）
 */
export function addQuestionRecord(
  session: ConvergenceSession,
  record: Omit<QuestionRecord, 'timestamp'>
): ConvergenceSession {
  const chain = getCurrentChain(session);
  if (!chain) return session;

  chain.questions.push({
    ...record,
    timestamp: new Date().toISOString()
  });

  session.totalQuestions++;

  // 更新收敛进度：使用最新问题的 convergenceScore
  if (record.convergenceScore !== undefined) {
    chain.convergenceScore = record.convergenceScore;
    session.convergenceProgress = Math.round(record.convergenceScore * 100);
  }

  // 如果有 emergingHypothesis，记录到 extractedAssumptions
  if (record.emergingHypothesis) {
    addExtractedAssumption(session, record.emergingHypothesis);
  }

  return session;
}

/**
 * 设置选定的问题聚焦
 */
export function setSelectedFocus(session: ConvergenceSession, focus: string): ConvergenceSession {
  session.selectedProblemFocus = focus;
  return session;
}

/**
 * 添加客户浮现的看法
 */
export function addEmergingInsight(session: ConvergenceSession, insight: string): ConvergenceSession {
  if (!session.emergingInsights.includes(insight)) {
    session.emergingInsights.push(insight);
  }
  return session;
}

/**
 * 更新收敛分数
 */
export function updateConvergenceScore(session: ConvergenceSession, score: number): ConvergenceSession {
  const chain = getCurrentChain(session);
  if (chain) {
    chain.convergenceScore = Math.max(0, Math.min(1, score));
    session.convergenceProgress = Math.round(chain.convergenceScore * 100);
  }
  return session;
}

/**
 * 提取并记录客户原话/假设
 */
export function addExtractedAssumption(session: ConvergenceSession, assumption: string): ConvergenceSession {
  const chain = getCurrentChain(session);
  if (chain && !chain.extractedAssumptions.includes(assumption)) {
    chain.extractedAssumptions.push(assumption);
  }
  return session;
}

/**
 * 设置假设（待客户确认）
 */
export function setHypothesis(
  session: ConvergenceSession,
  statement: string,
  userPhrasing: string,
  observableEvidence: string[],
  verificationMethod: string
): ConvergenceSession {
  session.hypothesis = {
    statement,
    userPhrasing,
    confirmedByUser: false,
    observableEvidence,
    verificationMethod,
    verificationPeriodDays: 7
  };
  return session;
}

/**
 * 客户确认假设
 */
export function confirmHypothesis(session: ConvergenceSession, confirmed: boolean): ConvergenceSession {
  if (session.hypothesis) {
    session.hypothesis.confirmedByUser = confirmed;
    if (confirmed) {
      session.stopReason = 'USER_CONFIRMED';
    }
  }
  return session;
}

// ============================================================
// 兼容旧函数名（逐步废弃）
// ============================================================

/** @deprecated 使用 loadConvergeSessions */
export const loadDiagnoseSessions = loadConvergeSessions;

/** @deprecated 使用 saveConvergeSessions */
export const saveDiagnoseSessions = saveConvergeSessions;

/** @deprecated 使用 addEmergingInsight */
export function addCognitiveErrorCandidate(session: ConvergenceSession, error: string): ConvergenceSession {
  return addEmergingInsight(session, error);
}

/** @deprecated 使用 addQuestionRecord */
export function addQuestionAnswer(
  session: ConvergenceSession,
  question: string,
  answer: string,
  targetAssumption?: string
): ConvergenceSession {
  const chain = getCurrentChain(session);
  if (!chain) return session;

  const depth = (chain.questions.length + 1) as 1 | 2 | 3;

  return addQuestionRecord(session, {
    depth,
    question,
    userAnswer: answer,
    targetAssumption
  });
}
