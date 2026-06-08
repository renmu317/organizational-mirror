/**
 * 认知对抗收敛模块 - 数据类型定义
 *
 * 核心原则：收敛的是「客户的认知」，不是「AI 的诊断」
 */

// 停止原因枚举
export type StopReason =
  | "HYPOTHESIS_EMERGED"       // 客户的假设已浮现（真收敛）
  | "DEPTH_LIMIT_REACHED"      // 达到深度限制（仅防啰嗦，非找到答案）
  | "VALIDATION_PLAN_READY"    // 验证计划就绪
  | "INSUFFICIENT_EVIDENCE"    // 证据不足（用户无法提供更多信息）
  | "USER_CONFIRMED"           // 用户确认了假设
  | null;                      // 未停止

// 问题链深度（最多3层）
export type QuestionDepth = 1 | 2 | 3;

// 单个问题记录（含AI自评的收敛信号）
export interface QuestionRecord {
  depth: QuestionDepth;
  question: string;
  userAnswer: string;
  timestamp: string;
  targetAssumption?: string;        // 这个问题要撬动的假设
  // AI 每轮自评的收敛信号
  attributionShifted?: boolean;     // 客户的归因是否已移动
  emergingHypothesis?: string;      // 客户正在逼近的工作假设（用客户的话）
  convergenceScore?: number;        // 0-1 收敛度
}

// 问题链
export interface QuestionChain {
  chainId: string;              // 唯一ID
  targetSymptom: string;        // 针对的症状
  questions: QuestionRecord[];
  convergenceScore: number;     // 0-1 收敛度（取最新问题的分数）
  extractedAssumptions: string[]; // 提取的客户原话/隐含假设
}

// 可验证假设（归属权在客户）
export interface Hypothesis {
  statement: string;            // 反映句：用客户原话复述，以提问结尾
  userPhrasing: string;         // 客户自己说过的关键原句（可引用）
  confirmedByUser: boolean;     // 客户是否确认，默认 false
  observableEvidence: string[]; // 可观测证据
  verificationMethod: string;   // 验证方法
  verificationPeriodDays: number; // 验证周期（天）
}

// 7天验证计划
export interface ValidationPlan {
  day1_3: string;               // 第1-3天任务
  day4_6: string;               // 第4-6天任务
  day7: string;                 // 第7天复盘
  dailyCheckItems: string[];    // 每日检查项
  successCriteria: string;      // 成功标准
}

// 收敛会话（原 DiagnosticSession）
export interface ConvergenceSession {
  sessionId: string;
  createdAt: string;

  // Rule 1: 问题聚焦
  primarySymptom: string;         // 主要症状
  secondarySymptoms: string[];    // 次要症状
  selectedProblemFocus: string;   // 选定的聚焦问题

  // Rule 2: 问题链（最多3层）
  questionChains: QuestionChain[];
  currentChainId: string | null;

  // Rule 3: 客户浮现的看法（不是"认知错误"）
  emergingInsights: string[];     // 客户自己说出的新看法

  // Rule 4: 停止条件
  stopReason: StopReason;

  // 输出
  hypothesis: Hypothesis | null;          // 客户的假设（待确认）
  sevenDayValidationPlan: ValidationPlan | null;
  convergenceSummary: string | null;      // 原 diagnosticReport，改为客户视角

  // 元数据
  matchedCaseIds: string[];        // 匹配的案例ID
  totalQuestions: number;
  convergenceProgress: number;     // 0-100%（= convergenceScore × 100）
}

// 最终输出格式（客户视角）
export interface ConvergenceOutput {
  primarySymptom: string;
  selectedProblemFocus: string;
  originalProblemDefinition: string;
  questionChains: QuestionChain[];
  emergingInsights: string[];       // 客户浮现的看法
  hypothesis: Hypothesis;           // 客户确认的假设
  stopReason: StopReason;
  sevenDayValidationPlan: ValidationPlan;
  convergenceSummary: string;       // 你的假设与实验
}

// 案例库条目（与现有 caseLibrary.json 结构一致）
export interface CaseEntry {
  id: string;
  industry: string;
  company_size: string;
  company_state: string;
  surface_problem: string;
  initial_explanation: string;
  cognition_source: string;
  real_bottleneck: string;
  friction_layer: string;
  recovery_type: string;
  failed_action: string;
  effective_action: string;
  key_questions: string[];
  adaptation_experiment: string;
  insight_confidence: 'high' | 'low' | 'needs_review';
  followup_result: any;
  completeness: 'skeleton' | 'gap' | 'enriched';
}

// API 请求/响应类型
export interface StartConvergeRequest {
  symptoms: string[];
}

export interface StartConvergeResponse {
  sessionId: string;
  primarySymptom: string;
  secondarySymptoms: string[];
  needsFocusSelection: boolean;
  suggestedFocus: string;
}

export interface SelectFocusRequest {
  sessionId: string;
  selectedFocus: string;
}

export interface SelectFocusResponse {
  success: boolean;
  firstQuestion: string;
}

export interface AnswerRequest {
  sessionId: string;
  answer: string;
}

export interface AnswerResponse {
  nextQuestion: string | null;
  currentDepth: QuestionDepth;
  convergenceProgress: number;
  shouldStop: boolean;
  stopReason: StopReason;
  // 当 shouldStop=true 且 readyForHypothesis 时，返回反映式假设供客户确认
  reflectiveHypothesis?: string;
  needsConfirmation?: boolean;
}

export interface ConfirmHypothesisRequest {
  sessionId: string;
  confirmed: boolean;
  modification?: string;    // 客户的修正（如果 confirmed=false）
}

export interface ConfirmHypothesisResponse {
  success: boolean;
  hypothesis?: Hypothesis;
  nextQuestion?: string;    // 如果客户否定，继续一轮
}

export interface GenerateOutputRequest {
  sessionId: string;
}

// 收敛边界检查结果
export interface ConvergenceBoundaryResult {
  shouldStop: boolean;
  reason: StopReason;
  readyForHypothesis: boolean;
}

// DeepSeek API 响应中的问题生成结果（含收敛信号）
export interface GeneratedQuestion {
  question: string;
  depth: QuestionDepth;
  targetAssumption: string;
  convergenceHint: string;
  // AI 自评的收敛信号
  attributionShifted: boolean;
  emergingHypothesis: string;
  convergenceScore: number;
}

// 兼容旧类型名（逐步废弃）
/** @deprecated 使用 ConvergenceSession */
export type DiagnosticSession = ConvergenceSession;
/** @deprecated 使用 ConvergenceOutput */
export type DiagnosticOutput = ConvergenceOutput;
