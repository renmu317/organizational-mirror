/**
 * 7天验证计划生成模块
 */

import { DiagnosticSession, Hypothesis, ValidationPlan } from './types';
import { buildValidationPlanPrompt } from './prompts';

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
 * 生成7天验证计划
 */
export async function generate7DayValidationPlan(
  hypothesis: Hypothesis,
  session: DiagnosticSession,
  apiKey: string
): Promise<ValidationPlan> {
  const prompt = buildValidationPlanPrompt(session, hypothesis);
  const response = await callDeepSeek(prompt, apiKey);
  const parsed = parseJsonResponse<ValidationPlan>(response);

  if (!parsed) {
    // 如果解析失败，生成默认验证计划
    return generateDefaultValidationPlan(hypothesis);
  }

  return {
    day1_3: parsed.day1_3 || '收集基线数据',
    day4_6: parsed.day4_6 || '实施小规模干预',
    day7: parsed.day7 || '复盘总结',
    dailyCheckItems: parsed.dailyCheckItems || ['记录关键指标', '观察变化'],
    successCriteria: parsed.successCriteria || '观察到预期方向的变化'
  };
}

/**
 * 生成默认验证计划（当 AI 解析失败时使用）
 */
function generateDefaultValidationPlan(hypothesis: Hypothesis): ValidationPlan {
  const evidence = hypothesis.observableEvidence || [];

  // 构建每日检查项
  const dailyCheckItems = evidence.slice(0, 3).map(e => `记录：${e}`);
  if (dailyCheckItems.length === 0) {
    dailyCheckItems.push('记录关键变化');
    dailyCheckItems.push('观察团队反应');
  }

  return {
    day1_3: `收集基线数据：${evidence.slice(0, 2).join('、') || '关键业务指标'}。每天花10分钟记录当前状态。`,
    day4_6: `实施小规模干预：${hypothesis.verificationMethod || '尝试一个小改变'}。观察团队和业务的响应。`,
    day7: '复盘对比：对比第1天和第7天的数据。总结哪些假设被验证、哪些被推翻。',
    dailyCheckItems,
    successCriteria: `核心指标出现可观测的变化，或者团队反馈与假设方向一致`
  };
}

/**
 * 格式化验证计划为可读文本
 */
export function formatValidationPlanAsText(plan: ValidationPlan): string {
  let text = '## 7天最小验证计划\n\n';

  text += '### 第1-3天：收集基线\n';
  text += plan.day1_3 + '\n\n';

  text += '### 第4-6天：小规模干预\n';
  text += plan.day4_6 + '\n\n';

  text += '### 第7天：复盘总结\n';
  text += plan.day7 + '\n\n';

  text += '### 每日检查项\n';
  plan.dailyCheckItems.forEach((item, i) => {
    text += `${i + 1}. ${item}\n`;
  });
  text += '\n';

  text += '### 成功标准\n';
  text += plan.successCriteria + '\n';

  return text;
}

/**
 * 生成简化的执行清单
 */
export function generateExecutionChecklist(plan: ValidationPlan): string[] {
  const checklist: string[] = [];

  // Day 1
  checklist.push('[ ] Day 1: 开始记录基线数据');
  plan.dailyCheckItems.forEach(item => {
    checklist.push(`    [ ] ${item}`);
  });

  // Day 2-3
  checklist.push('[ ] Day 2-3: 继续收集数据，保持记录');

  // Day 4
  checklist.push('[ ] Day 4: 开始实施小规模干预');

  // Day 5-6
  checklist.push('[ ] Day 5-6: 观察干预效果，继续记录');

  // Day 7
  checklist.push('[ ] Day 7: 复盘总结');
  checklist.push('    [ ] 对比第1天和第7天数据');
  checklist.push('    [ ] 评估假设是否被验证');
  checklist.push('    [ ] 记录主要发现');

  return checklist;
}

/**
 * 评估验证计划质量
 */
export function evaluateValidationPlanQuality(plan: ValidationPlan): {
  score: number;
  suggestions: string[];
} {
  const suggestions: string[] = [];
  let score = 100;

  // 检查各阶段描述
  if (plan.day1_3.length < 20) {
    suggestions.push('第1-3天任务描述过于简单，建议更具体');
    score -= 15;
  }

  if (plan.day4_6.length < 20) {
    suggestions.push('第4-6天任务描述过于简单，建议更具体');
    score -= 15;
  }

  if (plan.day7.length < 10) {
    suggestions.push('第7天复盘任务描述过于简单');
    score -= 10;
  }

  // 检查每日检查项
  if (plan.dailyCheckItems.length < 2) {
    suggestions.push('每日检查项过少，建议增加到3-5个');
    score -= 15;
  }

  if (plan.dailyCheckItems.length > 7) {
    suggestions.push('每日检查项过多，可能难以坚持，建议精简');
    score -= 10;
  }

  // 检查成功标准
  if (!plan.successCriteria || plan.successCriteria.length < 10) {
    suggestions.push('成功标准不够具体，难以判断是否达成');
    score -= 20;
  }

  // 检查是否有可量化元素
  const quantifiablePatterns = /\d+|%|次|个|天|周/;
  if (!quantifiablePatterns.test(plan.day1_3) &&
      !quantifiablePatterns.test(plan.day4_6) &&
      !quantifiablePatterns.test(plan.successCriteria)) {
    suggestions.push('建议增加可量化的目标或指标');
    score -= 10;
  }

  return {
    score: Math.max(0, score),
    suggestions
  };
}

/**
 * 计算验证计划的预计完成日期
 */
export function calculateCompletionDate(startDate: Date = new Date()): {
  day1: string;
  day3: string;
  day4: string;
  day6: string;
  day7: string;
} {
  const formatDate = (d: Date): string => {
    return d.toISOString().split('T')[0];
  };

  const addDays = (date: Date, days: number): Date => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  return {
    day1: formatDate(startDate),
    day3: formatDate(addDays(startDate, 2)),
    day4: formatDate(addDays(startDate, 3)),
    day6: formatDate(addDays(startDate, 5)),
    day7: formatDate(addDays(startDate, 6))
  };
}
