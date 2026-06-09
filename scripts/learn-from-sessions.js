/**
 * 从 Supabase 会话数据中学习
 *
 * 功能：
 * 1. 拉取高质量对话（完整收敛、有7天实验）
 * 2. 转化为案例库格式
 * 3. 分析成功模式
 * 4. 生成学习报告
 *
 * 使用：
 *   node scripts/learn-from-sessions.js
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CASE_LIBRARY_PATH = path.join(__dirname, '..', 'data', 'caseLibrary.json');

// ============================================================
// 从 Supabase 拉取会话
// ============================================================
async function fetchSessions(options = {}) {
  const { minTurns = 5, hasExperiment = true, limit = 50 } = options;

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sessions?select=*&order=created_at.desc&limit=${limit}`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch sessions: ${await response.text()}`);
  }

  let sessions = await response.json();

  // 筛选高质量对话
  sessions = sessions.filter(s => {
    // 至少有 minTurns 轮对话
    const turns = s.history?.filter(m => m.role === 'user').length || 0;
    if (turns < minTurns) return false;

    // 如果要求有实验，检查实验字段
    if (hasExperiment) {
      const exp = s.discovery_output?.seven_day_experiment;
      if (!exp || exp.experiment === '待设计' || exp.experiment === '待设计的最小实验') {
        return false;
      }
    }

    return true;
  });

  return sessions;
}

// ============================================================
// 转化为案例库格式
// ============================================================
function sessionToCase(session) {
  const userMessages = session.history?.filter(m => m.role === 'user') || [];
  const discovery = session.discovery_output || {};

  return {
    id: session.id,
    source: 'session',
    timestamp: session.created_at,

    // 基本信息
    industry: extractIndustry(userMessages),
    company_size: 'unknown',
    surface_problem: session.surface_problem || userMessages[0]?.content || '',
    initial_explanation: session.initial_explanation || userMessages[1]?.content || '',

    // 因果链
    causal_chain: discovery.world_model?.causal_chain || [],
    hidden_assumptions: discovery.world_model?.hidden_assumptions || [],

    // 发现
    real_bottleneck: discovery.redefined_problem || '',
    missing_variables: discovery.missing_variables || [],
    curiosity_questions: discovery.curiosity_questions || [],

    // 7天实验
    seven_day_experiment: discovery.seven_day_experiment || null,

    // 元数据
    path: session.path || 'unknown',
    completeness: 'gap', // 需要回访验证后升级为 enriched
    insight_confidence: 'medium',
    followup_due: session.followup_due,
    followup_result: session.followup_result
  };
}

// 从对话中提取行业关键词
function extractIndustry(userMessages) {
  const text = userMessages.map(m => m.content).join(' ');

  const industries = {
    '电商': ['电商', '淘宝', '京东', '天猫', '网店'],
    '教育': ['教育', '培训', '学校', '课程', '学生'],
    '餐饮': ['餐饮', '餐厅', '外卖', '食品'],
    'SaaS': ['SaaS', '软件', 'B2B', '企业服务'],
    '制造': ['制造', '工厂', '生产', '供应链'],
    '金融': ['金融', '银行', '保险', '投资'],
    '医疗': ['医疗', '医院', '健康', '诊所'],
    '零售': ['零售', '门店', '超市', '便利店']
  };

  for (const [industry, keywords] of Object.entries(industries)) {
    if (keywords.some(kw => text.includes(kw))) {
      return industry;
    }
  }

  return 'unknown';
}

// ============================================================
// 分析成功模式
// ============================================================
function analyzePatterns(sessions) {
  const patterns = {
    // 触发好奇心的问题类型
    curiosityTriggers: {},
    // 常见的缺失变量
    missingVariables: {},
    // 常见的隐藏假设
    hiddenAssumptions: {},
    // 路径分布
    pathDistribution: { early: 0, org: 0, unknown: 0 },
    // 平均轮数
    averageTurns: 0,
    // 完成率（有实验 / 总数）
    completionRate: 0
  };

  let totalTurns = 0;
  let withExperiment = 0;

  sessions.forEach(s => {
    // 路径分布
    patterns.pathDistribution[s.path || 'unknown']++;

    // 轮数
    const turns = s.history?.filter(m => m.role === 'user').length || 0;
    totalTurns += turns;

    // 有实验
    const exp = s.discovery_output?.seven_day_experiment;
    if (exp && exp.experiment && !exp.experiment.includes('待')) {
      withExperiment++;
    }

    // 缺失变量统计
    const vars = s.discovery_output?.missing_variables || [];
    vars.forEach(v => {
      patterns.missingVariables[v] = (patterns.missingVariables[v] || 0) + 1;
    });

    // 隐藏假设统计
    const assumptions = s.discovery_output?.world_model?.hidden_assumptions || [];
    assumptions.forEach(a => {
      patterns.hiddenAssumptions[a] = (patterns.hiddenAssumptions[a] || 0) + 1;
    });
  });

  patterns.averageTurns = sessions.length > 0 ? (totalTurns / sessions.length).toFixed(1) : 0;
  patterns.completionRate = sessions.length > 0 ? ((withExperiment / sessions.length) * 100).toFixed(1) + '%' : '0%';

  return patterns;
}

// ============================================================
// 导入到案例库
// ============================================================
function importToCaseLibrary(cases) {
  let library = [];

  try {
    if (fs.existsSync(CASE_LIBRARY_PATH)) {
      library = JSON.parse(fs.readFileSync(CASE_LIBRARY_PATH, 'utf-8'));
    }
  } catch (e) {
    console.log('案例库为空，创建新库');
  }

  // 检查重复
  const existingIds = new Set(library.map(c => c.id));
  const newCases = cases.filter(c => !existingIds.has(c.id));

  if (newCases.length === 0) {
    console.log('没有新案例需要导入');
    return library;
  }

  library.push(...newCases);
  fs.writeFileSync(CASE_LIBRARY_PATH, JSON.stringify(library, null, 2), 'utf-8');

  console.log(`导入 ${newCases.length} 条新案例`);
  return library;
}

// ============================================================
// 生成学习报告
// ============================================================
function generateReport(sessions, patterns) {
  const report = `
========================================
照见 - 学习报告
生成时间: ${new Date().toLocaleString('zh-CN')}
========================================

📊 数据概览
-----------
总对话数: ${sessions.length}
平均轮数: ${patterns.averageTurns}
完成率: ${patterns.completionRate}

📈 路径分布
-----------
早期验证 (early): ${patterns.pathDistribution.early}
组织诊断 (org): ${patterns.pathDistribution.org}
未分类: ${patterns.pathDistribution.unknown}

🔍 高频缺失变量 (Top 5)
----------------------
${Object.entries(patterns.missingVariables)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([v, count], i) => `${i + 1}. ${v} (${count}次)`)
  .join('\n') || '暂无数据'}

💡 常见隐藏假设 (Top 5)
----------------------
${Object.entries(patterns.hiddenAssumptions)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([a, count], i) => `${i + 1}. ${a} (${count}次)`)
  .join('\n') || '暂无数据'}

🎯 改进建议
-----------
${generateSuggestions(patterns)}

========================================
`;

  return report;
}

function generateSuggestions(patterns) {
  const suggestions = [];

  const completionRate = parseFloat(patterns.completionRate);
  if (completionRate < 50) {
    suggestions.push('- 完成率较低，考虑在中期增加收尾引导');
  }

  const avgTurns = parseFloat(patterns.averageTurns);
  if (avgTurns > 20) {
    suggestions.push('- 平均轮数较高，考虑优化阶段推进逻辑');
  } else if (avgTurns < 5) {
    suggestions.push('- 平均轮数较低，考虑增加深度探索');
  }

  if (patterns.pathDistribution.unknown > patterns.pathDistribution.early + patterns.pathDistribution.org) {
    suggestions.push('- 路径分类不明确，优化开场分流逻辑');
  }

  if (suggestions.length === 0) {
    suggestions.push('- 当前数据表现良好，继续观察');
  }

  return suggestions.join('\n');
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ 请在 .env.local 中配置 SUPABASE_URL 和 SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  console.log('📥 从 Supabase 拉取会话数据...\n');

  try {
    // 拉取所有会话（不过滤）
    const allSessions = await fetchSessions({ minTurns: 1, hasExperiment: false });
    console.log(`总共 ${allSessions.length} 条会话\n`);

    // 分析模式
    const patterns = analyzePatterns(allSessions);

    // 生成报告
    const report = generateReport(allSessions, patterns);
    console.log(report);

    // 筛选高质量会话并导入
    const qualitySessions = await fetchSessions({ minTurns: 5, hasExperiment: true });
    if (qualitySessions.length > 0) {
      console.log(`\n📚 ${qualitySessions.length} 条高质量对话可导入案例库`);

      const cases = qualitySessions.map(sessionToCase);
      importToCaseLibrary(cases);
    }

    // 保存报告
    const reportPath = path.join(__dirname, '..', 'data', 'learning-report.txt');
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`\n📄 报告已保存到: ${reportPath}`);

  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
}

main();
