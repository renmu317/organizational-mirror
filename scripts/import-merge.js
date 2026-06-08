/**
 * 案例合并导入脚本
 *
 * 用法: node scripts/import-merge.js
 *
 * 功能: 合并多个采集表xlsx文件，去重后输出到caseLibrary.json
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// 待合并的文件列表
const FILES_TO_MERGE = [
  '/Users/renmu/企业组织认知系统/数据库/企业认知决策问题数据收集表.xlsx',
  '/Users/renmu/企业组织认知系统/数据库/企业认知决策问题数据收集表(2)(1).xlsx',
  '/Users/renmu/企业组织认知系统/数据库/企业认知决策问题数据收集表02.xlsx'
];

// 列映射（基于采集表结构，列号从0开始）
const COLUMN_MAP = {
  industry: 3,
  company_size: 4,
  company_state: 5,
  surface_problem: 7,
  owner_thinks: 8,
  owner_why: 9,
  failed_action: 10,
  recovery_type: 17,
  real_bottleneck: 20,
  cognition_source: 21,
  cognition_name: 22,
  effective_action: 23,
  company_name: 1,
  owner_name: 2,
};

// real_bottleneck 枚举映射
const BOTTLENECK_KEYWORDS = {
  '利润': 'profit_model_error',
  '盈利': 'profit_model_error',
  '成本': 'profit_model_error',
  '现金': 'cashflow_structure',
  '资金': 'cashflow_structure',
  '融资': 'cashflow_structure',
  '组织': 'org_capability',
  '团队': 'org_capability',
  '能力': 'org_capability',
  '人才': 'org_capability',
  '决策': 'decision_architecture',
  '管理': 'decision_architecture',
  '战略': 'marketing_strategy',
  '定位': 'marketing_strategy',
  '市场': 'marketing_strategy',
  '产品': 'product_homogeneity',
  '同质': 'product_homogeneity',
  '竞争': 'product_homogeneity',
  '周期': 'market_cycle',
  '行业': 'market_cycle',
  '经济': 'market_cycle',
  '共识': 'consensus_failure',
  '沟通': 'consensus_failure',
};

const EXTERNAL_ATTRIBUTION_KEYWORDS = [
  '销售', '执行', '市场', '行业', '经济', '政策', '竞争',
  '客户', '对手', '员工', '人员', '团队不行', '不努力'
];

const STRUCTURAL_BOTTLENECKS = [
  'profit_model_error', 'cashflow_structure', 'org_capability',
  'decision_architecture', 'consensus_failure'
];

function anonymize(text) {
  if (!text || typeof text !== 'string') return text;
  let result = text.replace(/[王李张刘陈杨黄赵周吴][A-Za-z\u4e00-\u9fa5]{0,2}(总|先生|女士|老板|董事长|经理)/g, '某负责人');
  result = result.replace(/[A-Za-z\u4e00-\u9fa5]{2,10}(公司|集团|企业|有限|股份|科技|实业)/g, '该企业');
  result = result.replace(/(清华|北大|复旦|交大|浙大|[A-Za-z\u4e00-\u9fa5]{2,6}大学)/g, '某高校');
  result = result.replace(/(工商银行|建设银行|农业银行|中国银行|招商银行|[A-Za-z\u4e00-\u9fa5]{2,4}银行)/g, '某银行');
  result = result.replace(/(\d+)(万|亿|千万)/g, (match, num, unit) => {
    const n = parseInt(num);
    if (unit === '亿' || (unit === '万' && n >= 1000)) return '数十亿级';
    else if (unit === '千万' || (unit === '万' && n >= 100)) return '数千万级';
    else return '数百万级';
  });
  return result;
}

function extractBottleneck(text) {
  if (!text || typeof text !== 'string') return '';
  const found = new Set();
  for (const [keyword, bottleneck] of Object.entries(BOTTLENECK_KEYWORDS)) {
    if (text.includes(keyword)) found.add(bottleneck);
  }
  return Array.from(found).join(',') || 'unknown';
}

function isExternalAttribution(text) {
  if (!text) return false;
  return EXTERNAL_ATTRIBUTION_KEYWORDS.some(kw => text.includes(kw));
}

function hasLayerJump(initialExplanation, realBottleneck) {
  if (!initialExplanation || !realBottleneck) return false;
  const isExternal = isExternalAttribution(initialExplanation);
  const bottlenecks = realBottleneck.split(',');
  const isStructural = bottlenecks.some(b => STRUCTURAL_BOTTLENECKS.includes(b));
  return isExternal && isStructural;
}

function hasActionCorroboration(effectiveAction, realBottleneck, failedAction) {
  if (!effectiveAction || !realBottleneck) return false;
  if (failedAction && effectiveAction.includes(failedAction.substring(0, 5))) return false;
  const bottlenecks = realBottleneck.split(',');
  const actionKeywords = {
    'profit_model_error': ['利润', '盈利', '成本', '定价', '毛利'],
    'cashflow_structure': ['现金', '资金', '融资', '回款', '账期'],
    'org_capability': ['团队', '能力', '培训', '招聘', '组织'],
    'decision_architecture': ['决策', '流程', '授权', '管理'],
    'marketing_strategy': ['战略', '定位', '差异', '市场'],
    'product_homogeneity': ['产品', '创新', '差异化', '研发'],
  };
  for (const bottleneck of bottlenecks) {
    const keywords = actionKeywords[bottleneck] || [];
    if (keywords.some(kw => effectiveAction.includes(kw))) return true;
  }
  return false;
}

function calculateInsightConfidence(caseData) {
  const hasJump = hasLayerJump(caseData.initial_explanation, caseData.real_bottleneck);
  const hasCorroboration = hasActionCorroboration(
    caseData.effective_action, caseData.real_bottleneck, caseData.failed_action
  );
  return (hasJump && hasCorroboration) ? 'high' : 'low';
}

function determineCompleteness(caseData) {
  const hasInitialExplanation = caseData.initial_explanation && caseData.initial_explanation.trim();
  const hasRealBottleneck = caseData.real_bottleneck && caseData.real_bottleneck.trim() && caseData.real_bottleneck !== 'unknown';
  const hasRecoveryType = caseData.recovery_type && caseData.recovery_type.trim();
  if (hasInitialExplanation && hasRealBottleneck && hasRecoveryType) {
    if (caseData.key_questions && caseData.key_questions.length > 0) return 'enriched';
    return 'gap';
  }
  return 'skeleton';
}

function generateId(industry, companySize, index) {
  const ind = industry || '未知行业';
  const size = companySize || '未知规模';
  const seq = String(index).padStart(3, '0');
  return `${ind}·${size}·C${seq}`;
}

function parseRecoveryType(text) {
  if (!text) return '';
  if (text.includes('目标') || text.includes('放弃') || text.includes('转型')) return '换目标';
  if (text.includes('方法') || text.includes('调整') || text.includes('改进')) return '换方法';
  return text.trim();
}

function createCaseFingerprint(caseData) {
  // Create a fingerprint for deduplication
  return [
    caseData.industry,
    caseData.company_size,
    caseData.surface_problem?.substring(0, 50),
  ].join('|').toLowerCase();
}

function processFile(xlsxPath) {
  console.log(`\n处理文件: ${path.basename(xlsxPath)}`);

  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  let rows = data.slice(1).filter(row => row && row.length > 0);

  // Skip extra header row if detected
  if (rows.length > 0) {
    const firstRowText = rows[0].join(' ');
    if (firstRowText.includes('例如') && firstRowText.includes('其他') && firstRowText.length > 300) {
      rows = rows.slice(1);
    }
  }

  console.log(`  行数: ${rows.length}`);

  const cases = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (!row[COLUMN_MAP.industry] && !row[COLUMN_MAP.surface_problem]) continue;

    const industry = String(row[COLUMN_MAP.industry] || '').trim();
    const companySize = String(row[COLUMN_MAP.company_size] || '').trim();
    const companyState = String(row[COLUMN_MAP.company_state] || '').trim();
    const surfaceProblem = anonymize(String(row[COLUMN_MAP.surface_problem] || '').trim());

    const ownerThinks = anonymize(String(row[COLUMN_MAP.owner_thinks] || '').trim());
    const ownerWhy = anonymize(String(row[COLUMN_MAP.owner_why] || '').trim());
    const initialExplanation = [ownerThinks, ownerWhy].filter(Boolean).join('；');

    const failedAction = anonymize(String(row[COLUMN_MAP.failed_action] || '').trim());
    const recoveryType = parseRecoveryType(String(row[COLUMN_MAP.recovery_type] || ''));

    const realBottleneckRaw = anonymize(String(row[COLUMN_MAP.real_bottleneck] || '').trim());
    const realBottleneck = extractBottleneck(realBottleneckRaw);

    const cognitionSource = anonymize(String(row[COLUMN_MAP.cognition_source] || '').trim());
    const effectiveAction = anonymize(String(row[COLUMN_MAP.effective_action] || '').trim());

    const caseData = {
      industry,
      company_size: companySize,
      company_state: companyState,
      surface_problem: surfaceProblem,
      initial_explanation: initialExplanation,
      cognition_source: cognitionSource,
      real_bottleneck: realBottleneck,
      friction_layer: '',
      recovery_type: recoveryType,
      failed_action: failedAction,
      effective_action: effectiveAction,
      key_questions: [],
      adaptation_experiment: '',
      insight_confidence: 'low',
      followup_result: null,
      completeness: 'skeleton'
    };

    caseData.insight_confidence = calculateInsightConfidence(caseData);
    caseData.completeness = determineCompleteness(caseData);

    cases.push(caseData);
  }

  console.log(`  提取案例: ${cases.length}`);
  return cases;
}

function mergeAndDedupe(allCases) {
  const seen = new Map();
  const merged = [];

  for (const c of allCases) {
    const fp = createCaseFingerprint(c);
    if (!seen.has(fp)) {
      seen.set(fp, true);
      merged.push(c);
    }
  }

  // Assign IDs
  for (let i = 0; i < merged.length; i++) {
    merged[i].id = generateId(merged[i].industry, merged[i].company_size, i + 1);
  }

  return merged;
}

// Main
console.log('='.repeat(60));
console.log('组织镜子 - 案例合并导入脚本');
console.log('='.repeat(60));

const allCases = [];

for (const filePath of FILES_TO_MERGE) {
  if (fs.existsSync(filePath)) {
    const cases = processFile(filePath);
    allCases.push(...cases);
  } else {
    console.log(`\n跳过不存在的文件: ${path.basename(filePath)}`);
  }
}

const merged = mergeAndDedupe(allCases);

// Statistics
let skeletonCount = 0, gapCount = 0, enrichedCount = 0, highConfidenceCount = 0;
for (const c of merged) {
  if (c.completeness === 'skeleton') skeletonCount++;
  else if (c.completeness === 'gap') gapCount++;
  else if (c.completeness === 'enriched') enrichedCount++;
  if (c.insight_confidence === 'high') highConfidenceCount++;
}

// Write output
const outputPath = path.join(__dirname, '..', 'data', 'caseLibrary.json');
fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');

console.log('\n' + '='.repeat(60));
console.log('合并完成');
console.log('='.repeat(60));
console.log(`
原始总数:         ${allCases.length}
去重后总数:       ${merged.length}
├─ skeleton:      ${skeletonCount} (空壳，不参与检索)
├─ gap:           ${gapCount} (活跃库)
└─ enriched:      ${enrichedCount} (活跃库，优先级最高)

活跃库条数:       ${gapCount + enrichedCount}
高置信度案例:     ${highConfidenceCount}

输出文件: ${outputPath}
`);
console.log('='.repeat(60));
