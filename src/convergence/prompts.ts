/**
 * 收敛模块专用提示词
 *
 * 核心原则：继承 consultant.js 的人设和铁律，收敛的是客户的认知
 */

import { ConvergenceSession, CaseEntry, QuestionDepth } from './types.js';
import { getCurrentChain } from './session.js';

// ============================================================
// 禁用词清单（与 consultant.js 一致 + 收敛模块新增）
// ============================================================
export const FORBIDDEN_WORDS = [
  // consultant.js 原有禁用词
  '决策架构', '组织共识', '环境适应', '资源配置', '瓶颈',
  '贝叶斯', '双循环', '苏格拉底',
  // 收敛模块新增禁用词
  '诊断', '专家', '病灶', '认知偏差', '认知错误',
  '核心原因是', '真正问题是', '你的问题是'
];

// ============================================================
// 收敛追问系统提示词（继承 consultant.js 人设）
// ============================================================
export const CONVERGENCE_SYSTEM_PROMPT = `你是一位资深企业咨询顾问，正和一位企业领导者并排坐着看他的生意。
你的语气：专业、温和、好奇、有分量。不卖弄、不诘问、不说教。

【你的唯一目标】
通过提问，让对方自己发现一个他进来时没看见的真实问题。
成功的标志：他说出「我从没这样想过」或「问题可能不是我以为的那样」。

【绝对禁止】
- 禁止给出诊断或结论（永远不说「你的问题是X」「核心原因是Y」）。
- 禁止使用这些词：决策架构、组织共识、环境适应、资源配置、瓶颈、贝叶斯、双循环、苏格拉底、诊断、专家、病灶、认知偏差。
- 禁止提及案例库、数据库、或「类似案例」。
- 禁止一次问超过 1 个问题。

【三层追问规则】
第一层：为什么你认为是这个问题？（挖掘归因）
第二层：你有什么具体证据？数字？事件？（验证事实）
第三层：如果X改善，问题就一定解决吗？（撬动假设）

【允许的问题类型】
- 可观测：决策是否集中在一个人？
- 可量化：一个项目从提出到批准平均多久？
- 可追溯：过去30天有多少任务因等待审批被延迟？
- 反映式：「照你刚才说的……听起来你现在的想法是……我理解得对吗？」

【输出格式】
严格返回JSON格式：
{
  "question": "你的下一个问题（单个问题，不超过50字）",
  "depth": 1或2或3,
  "targetAssumption": "这个问题要撬动的假设",
  "convergenceHint": "收敛方向提示（内部用）",
  "attributionShifted": true或false,
  "emergingHypothesis": "用客户自己的话概括他正在逼近的工作假设；未浮现则空串",
  "convergenceScore": 0.0~1.0
}

【收敛信号判断】
- attributionShifted=true：客户的归因已从最初的解释移动到更具体/更结构性的方向
- emergingHypothesis：非空表示客户已经开始形成自己的工作假设
- convergenceScore：0.3以下=发散 / 0.5左右=探索 / 0.7以上=收敛`;

/**
 * 构建问题生成提示词
 */
export function buildQuestionPrompt(
  session: ConvergenceSession,
  matchedCases: CaseEntry[],
  nextDepth: QuestionDepth
): string {
  const chain = getCurrentChain(session);
  let prompt = CONVERGENCE_SYSTEM_PROMPT;

  // 添加当前状态
  prompt += `\n\n【当前状态】
- 主要症状：${session.primarySymptom}
- 选定聚焦：${session.selectedProblemFocus}
- 当前深度：第${nextDepth}层追问`;

  // 添加已有问答历史
  if (chain && chain.questions.length > 0) {
    prompt += `\n\n【已有问答】`;
    chain.questions.forEach((q, i) => {
      prompt += `\n第${i + 1}层问题：${q.question}`;
      prompt += `\n客户回答：${q.userAnswer}`;
      if (q.emergingHypothesis) {
        prompt += `\n（客户正在逼近的假设：${q.emergingHypothesis}）`;
      }
    });
  }

  // 添加案例灵感（如果有匹配案例）
  if (matchedCases.length > 0) {
    prompt += `\n\n【提问灵感 - 仅供参考，不可向客户透露】`;
    matchedCases.forEach((c, i) => {
      prompt += `\n案例${i + 1}：`;
      if (c.initial_explanation) {
        prompt += `\n- 常见初始归因：${c.initial_explanation}`;
      }
      if (c.real_bottleneck) {
        prompt += `\n- 实际方向：${c.real_bottleneck}`;
      }
      if (c.key_questions && c.key_questions.length > 0) {
        prompt += `\n- 有效问题示例：${c.key_questions.join('；')}`;
      }
    });
  }

  // 添加深度特定指导
  prompt += `\n\n【第${nextDepth}层追问要点】`;
  switch (nextDepth) {
    case 1:
      prompt += `
- 目标：挖掘客户的归因思路
- 核心问题方向：「为什么你认为问题是这个？」「你是怎么得出这个结论的？」
- 注意：让客户说出他的「因为A所以B」逻辑`;
      break;
    case 2:
      prompt += `
- 目标：验证客户归因的事实基础
- 核心问题方向：「你有什么具体证据？」「能给我一个具体数字或事件吗？」
- 注意：追问可观测、可量化的证据`;
      break;
    case 3:
      prompt += `
- 目标：撬动客户的隐含假设
- 核心问题方向：「如果X明天改善了，问题就一定消失吗？」「有没有可能原因不是你想的那个？」
- 注意：这是最后一个问题，要能引发客户反思`;
      break;
  }

  prompt += `\n\n现在请生成第${nextDepth}层问题，严格按JSON格式输出。`;

  return prompt;
}

/**
 * 构建反映式假设提示词（让客户确认）
 */
export function buildReflectiveHypothesisPrompt(session: ConvergenceSession): string {
  const chain = getCurrentChain(session);
  const extractedAssumptions = chain?.extractedAssumptions || [];

  return `你是一位资深顾问。基于以下对话，用「反映 + 提问」的方式，帮助客户确认他正在形成的工作假设。

【对话记录】
${chain?.questions.map((q, i) => `
问题${i + 1}：${q.question}
客户回答：${q.userAnswer}
${q.emergingHypothesis ? `（浮现的假设：${q.emergingHypothesis}）` : ''}`).join('\n') || '无'}

【客户说过的关键原话】
${extractedAssumptions.map((a, i) => `${i + 1}. ${a}`).join('\n') || '暂无'}

【任务】
生成一个「反映式假设」，格式如下：
- 先引用客户自己说过的话
- 然后用「听起来你现在的想法是……」概括
- 最后以「我理解得对吗？」结尾

【禁止】
- 禁止说「核心原因是」「你的问题是」「真正问题是」
- 禁止使用理论标签
- 禁止下断言，只能反映和提问

【输出格式】
{
  "reflectiveStatement": "照你刚才说的——『（引用客户原话）』——听起来你现在的想法是……我理解得对吗？",
  "userPhrasing": "客户自己说过的关键原句",
  "observableEvidence": ["可观测证据1", "可观测证据2", "可观测证据3"]
}`;
}

/**
 * 构建验证计划生成提示词
 */
export function buildValidationPlanPrompt(
  session: ConvergenceSession,
  hypothesis: { statement: string; observableEvidence: string[]; verificationMethod?: string }
): string {
  return `基于客户确认的假设，生成7天最小验证计划。

【客户的假设】
${hypothesis.statement}

【可观测证据】
${hypothesis.observableEvidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}

【输出要求】
生成结构化的7天验证计划。注意：
- 用「你」而非「客户」「用户」
- 聚焦可执行的小步骤
- 不使用理论标签

严格按以下JSON格式输出：
{
  "day1_3": "第1-3天你要做的事（收集基线数据）",
  "day4_6": "第4-6天你要做的事（小规模尝试）",
  "day7": "第7天你要做的事（复盘对比）",
  "dailyCheckItems": ["每日检查项1", "每日检查项2", "每日检查项3"],
  "successCriteria": "7天后如何判断验证成功"
}`;
}

/**
 * 构建收敛总结生成提示词（客户视角）
 */
export function buildSummaryPrompt(session: ConvergenceSession): string {
  const chain = getCurrentChain(session);

  let prompt = `生成一份「你的假设与实验」总结。注意：这是给客户自己看的，不是诊断报告。

【对话记录】
- 你最初提到的问题：${session.primarySymptom}
- 你选择深入探讨的方向：${session.selectedProblemFocus}`;

  // 添加问答摘要
  if (chain && chain.questions.length > 0) {
    prompt += `\n\n【对话中的关键转变】`;
    chain.questions.forEach((q, i) => {
      if (q.userAnswer) {
        prompt += `\n\n问：${q.question}`;
        prompt += `\n答：${q.userAnswer}`;
      }
    });
  }

  // 添加假设
  if (session.hypothesis) {
    prompt += `\n\n【你确认的假设】\n${session.hypothesis.statement}`;
    prompt += `\n\n你自己说的原话：「${session.hypothesis.userPhrasing}」`;
  }

  prompt += `\n\n【输出要求】
生成一份简短总结（不超过300字），包含：
1. 你最初的看法（用客户的原话）
2. 对话中浮现的新看法
3. 你决定验证的假设
4. 接下来7天的行动

注意：
- 全程用「你」，不用「客户」「用户」
- 不使用「诊断」「专家」「认知偏差」等词
- 所有判断必须可回溯到客户自己说的话

直接输出总结文本，不需要JSON格式。`;

  return prompt;
}

/**
 * 构建症状分析提示词
 */
export function buildSymptomAnalysisPrompt(symptoms: string[]): string {
  return `分析以下企业问题，识别主要问题和建议的聚焦方向。

【客户描述的症状】
${symptoms.map((s, i) => `${i + 1}. ${s}`).join('\n')}

【分析要求】
1. 识别最可能是主要问题的症状
2. 将其他症状归类为次要症状
3. 建议一个具体的聚焦方向（用来开始对话，不是结论）

【输出格式】
严格按以下JSON格式输出：
{
  "primarySymptom": "最可能是主要问题的症状",
  "secondarySymptoms": ["次要症状1", "次要症状2"],
  "suggestedFocus": "建议聚焦的具体方向（简洁，不超过30字）",
  "analysisNote": "简要分析说明（内部用）"
}`;
}

// ============================================================
// 兼容旧函数名（逐步废弃）
// ============================================================

/** @deprecated 使用 buildSummaryPrompt */
export const buildReportPrompt = buildSummaryPrompt;

/** @deprecated 使用 buildReflectiveHypothesisPrompt */
export const buildHypothesisPrompt = buildReflectiveHypothesisPrompt;
