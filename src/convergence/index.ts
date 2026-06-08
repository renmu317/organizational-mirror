/**
 * 认知对抗收敛模块 - 主入口
 *
 * 核心原则：收敛的是「客户的认知」，不是「AI 的诊断」
 */

// 类型定义
export * from './types.js';

// 会话管理
export {
  generateSessionId,
  generateChainId,
  createSession,
  loadConvergeSessions,
  saveConvergeSessions,
  getSessionById,
  updateSession,
  getCurrentChain,
  createQuestionChain,
  startNewChain,
  getCurrentDepth,
  addQuestionRecord,
  setSelectedFocus,
  addEmergingInsight,
  updateConvergenceScore,
  addExtractedAssumption,
  setHypothesis,
  confirmHypothesis,
  // 兼容旧函数名
  loadDiagnoseSessions,
  saveDiagnoseSessions,
  addCognitiveErrorCandidate,
  addQuestionAnswer
} from './session.js';

// 收敛边界检查
export {
  checkConvergenceBoundary,
  checkInsufficientEvidence,
  shouldStopQuestioning,
  calculateConvergenceScore,
  getStopReasonDescription,
  determineNextAction
} from './convergence.js';

// 问题链生成
export {
  analyzeSymptoms,
  generateNextQuestion,
  processAnswer,
  generateFirstQuestion,
  // 兼容旧函数名
  processAnswerAndGenerateNext,
  // 重命名以避免与 hypothesis.ts 冲突
  generateReflectiveHypothesis as generateReflectiveHypothesisFromChain
} from './questionChain.js';

// 假设生成（主版本）
export {
  generateReflectiveHypothesis,
  processHypothesisConfirmation,
  evaluateHypothesisQuality,
  refineHypothesis,
  // 兼容旧函数名
  generateHypothesis
} from './hypothesis.js';

// 验证计划
export {
  generate7DayValidationPlan,
  formatValidationPlanAsText,
  calculateCompletionDate
} from './validation.js';

// 收敛总结生成
export {
  generateConvergenceSummary,
  generateConvergenceOutput,
  generateBriefSummary,
  exportConvergenceAsJson,
  generateShareableText,
  // 兼容旧函数名
  generateDiagnosticReport,
  generateDiagnosticOutput,
  generateSummary,
  exportDiagnosisAsJson
} from './report.js';

// 提示词（主要供内部使用）
export {
  FORBIDDEN_WORDS,
  CONVERGENCE_SYSTEM_PROMPT,
  buildQuestionPrompt,
  buildReflectiveHypothesisPrompt,
  buildValidationPlanPrompt,
  buildSummaryPrompt,
  buildSymptomAnalysisPrompt,
  // 兼容旧函数名
  buildReportPrompt,
  buildHypothesisPrompt
} from './prompts.js';
