/**
 * 案例导入脚本
 *
 * 用法: node scripts/import.js <xlsx文件路径>
 *
 * 功能:
 * 1. 读取采集表 xlsx
 * 2. 匿名化处理（删除公司名、人名等可识别信息）
 * 3. 自动判级（skeleton/gap/enriched）
 * 4. 计算 insight_confidence（结构裁判）
 * 5. 输出 data/caseLibrary.json
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// 列映射（基于采集表结构，列号从0开始）
const COLUMN_MAP = {
  industry: 3,           // 列4: 行业
  company_size: 4,       // 列5: 企业规模人数
  company_state: 5,      // 列6: 企业状态
  surface_problem: 7,    // 列8: 企业遇到的问题
  owner_thinks: 8,       // 列9: 老板认为的问题
  owner_why: 9,          // 列10: 为什么这样认为
  failed_action: 10,     // 列11: 关键决策
  recovery_type: 17,     // 列18: 是否更新方法/目标
  real_bottleneck: 20,   // 列21: 是否发现真正问题
  cognition_source: 21,  // 列22: 认知来源
  cognition_name: 22,    // 列23: 认知来源名字（需删除）
  effective_action: 23,  // 列24: 如果重来
  company_name: 1,       // 列2: 企业名称（需删除）
  owner_name: 2,         // 列3: 实际控制人（需删除）
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

// 外部/执行类归因关键词（用于判断是否跳层）
const EXTERNAL_ATTRIBUTION_KEYWORDS = [
  '销售', '执行', '市场', '行业', '经济', '政策', '竞争',
  '客户', '对手', '员工', '人员', '团队不行', '不努力'
];

// 结构/认知类枚举（跳层目标）
const STRUCTURAL_BOTTLENECKS = [
  'profit_model_error', 'cashflow_structure', 'org_capability',
  'decision_architecture', 'consensus_failure'
];

/**
 * 匿名化处理
 */
function anonymize(text) {
  if (!text || typeof text !== 'string') return text;

  // 删除具体人名模式（X总、X先生、X女士等）
  let result = text.replace(/[王李张刘陈杨黄赵周吴][A-Za-z\u4e00-\u9fa5]{0,2}(总|先生|女士|老板|董事长|经理)/g, '某负责人');

  // 删除具体公司名模式
  result = result.replace(/[A-Za-z\u4e00-\u9fa5]{2,10}(公司|集团|企业|有限|股份|科技|实业)/g, '该企业');

  // 删除具体学校名
  result = result.replace(/(清华|北大|复旦|交大|浙大|[A-Za-z\u4e00-\u9fa5]{2,6}大学)/g, '某高校');

  // 删除具体银行名
  result = result.replace(/(工商银行|建设银行|农业银行|中国银行|招商银行|[A-Za-z\u4e00-\u9fa5]{2,4}银行)/g, '某银行');

  // 泛化具体金额
  result = result.replace(/(\d+)(万|亿|千万)/g, (match, num, unit) => {
    const n = parseInt(num);
    if (unit === '亿' || (unit === '万' && n >= 1000)) {
      return '数十亿级';
    } else if (unit === '千万' || (unit === '万' && n >= 100)) {
      return '数千万级';
    } else {
      return '数百万级';
    }
  });

  return result;
}

/**
 * 提取 real_bottleneck 枚举标签
 */
function extractBottleneck(text) {
  if (!text || typeof text !== 'string') return '';

  const found = new Set();
  for (const [keyword, bottleneck] of Object.entries(BOTTLENECK_KEYWORDS)) {
    if (text.includes(keyword)) {
      found.add(bottleneck);
    }
  }

  return Array.from(found).join(',') || 'unknown';
}

/**
 * 判断初始归因是否为外部/执行类
 */
function isExternalAttribution(text) {
  if (!text) return false;
  return EXTERNAL_ATTRIBUTION_KEYWORDS.some(kw => text.includes(kw));
}

/**
 * 判断是否发生层级跳变
 */
function hasLayerJump(initialExplanation, realBottleneck) {
  if (!initialExplanation || !realBottleneck) return false;

  // 初始归因是外部/执行类
  const isExternal = isExternalAttribution(initialExplanation);

  // 真正问题是结构/认知类
  const bottlenecks = realBottleneck.split(',');
  const isStructural = bottlenecks.some(b => STRUCTURAL_BOTTLENECKS.includes(b));

  return isExternal && isStructural;
}

/**
 * 判断「如果重来」是否印证了真正问题
 */
function hasActionCorroboration(effectiveAction, realBottleneck, failedAction) {
  if (!effectiveAction || !realBottleneck) return false;

  // 检查「重来」动作是否与失败动作不同
  if (failedAction && effectiveAction.includes(failedAction.substring(0, 5))) {
    return false; // 动作相似，未印证
  }

  // 检查「重来」动作是否针对真正问题
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
    if (keywords.some(kw => effectiveAction.includes(kw))) {
      return true;
    }
  }

  return false;
}

/**
 * 计算 insight_confidence
 */
function calculateInsightConfidence(caseData) {
  const hasJump = hasLayerJump(caseData.initial_explanation, caseData.real_bottleneck);
  const hasCorroboration = hasActionCorroboration(
    caseData.effective_action,
    caseData.real_bottleneck,
    caseData.failed_action
  );

  return (hasJump && hasCorroboration) ? 'high' : 'low';
}

/**
 * 判断补全级别
 */
function determineCompleteness(caseData) {
  const hasInitialExplanation = caseData.initial_explanation && caseData.initial_explanation.trim();
  const hasRealBottleneck = caseData.real_bottleneck && caseData.real_bottleneck.trim() && caseData.real_bottleneck !== 'unknown';
  const hasRecoveryType = caseData.recovery_type && caseData.recovery_type.trim();

  // 三必备字段齐全 → gap
  if (hasInitialExplanation && hasRealBottleneck && hasRecoveryType) {
    // 有 key_questions 且非空 → enriched
    if (caseData.key_questions && caseData.key_questions.length > 0) {
      return 'enriched';
    }
    return 'gap';
  }

  return 'skeleton';
}

/**
 * 生成案例代号
 */
function generateId(industry, companySize, index) {
  const ind = industry || '未知行业';
  const size = companySize || '未知规模';
  const seq = String(index).padStart(3, '0');
  return `${ind}·${size}·C${seq}`;
}

/**
 * 解析 recovery_type
 */
function parseRecoveryType(text) {
  if (!text) return '';
  if (text.includes('目标') || text.includes('放弃') || text.includes('转型')) {
    return '换目标';
  }
  if (text.includes('方法') || text.includes('调整') || text.includes('改进')) {
    return '换方法';
  }
  return text.trim();
}

/**
 * 主函数：导入 xlsx 并生成 caseLibrary.json
 */
function importCases(xlsxPath) {
  console.log('='.repeat(60));
  console.log('组织镜子 - 案例导入脚本');
  console.log('='.repeat(60));
  console.log(`\n读取文件: ${xlsxPath}\n`);

  // 读取 xlsx
  const workbook = XLSX.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  // 跳过表头（第一行是列标题）
  let rows = data.slice(1).filter(row => row && row.length > 0);

  // 额外检测：如果第一行看起来像表头描述，也跳过
  if (rows.length > 0) {
    const firstRowText = rows[0].join(' ');
    // 表头描述行通常很长且包含"例如"、"其他"等说明文字
    if (firstRowText.includes('例如') && firstRowText.includes('其他') && firstRowText.length > 300) {
      rows = rows.slice(1);
      console.log('检测到额外表头行，已跳过\n');
    }
  }

  console.log(`总行数: ${rows.length}\n`);

  const cases = [];
  let skeletonCount = 0;
  let gapCount = 0;
  let enrichedCount = 0;
  let highConfidenceCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // 跳过空行
    if (!row[COLUMN_MAP.industry] && !row[COLUMN_MAP.surface_problem]) {
      continue;
    }

    // 提取并匿名化字段
    const industry = String(row[COLUMN_MAP.industry] || '').trim();
    const companySize = String(row[COLUMN_MAP.company_size] || '').trim();
    const companyState = String(row[COLUMN_MAP.company_state] || '').trim();
    const surfaceProblem = anonymize(String(row[COLUMN_MAP.surface_problem] || '').trim());

    // 合并「老板认为的问题」+「为什么」作为 initial_explanation
    const ownerThinks = anonymize(String(row[COLUMN_MAP.owner_thinks] || '').trim());
    const ownerWhy = anonymize(String(row[COLUMN_MAP.owner_why] || '').trim());
    const initialExplanation = [ownerThinks, ownerWhy].filter(Boolean).join('；');

    const failedAction = anonymize(String(row[COLUMN_MAP.failed_action] || '').trim());
    const recoveryType = parseRecoveryType(String(row[COLUMN_MAP.recovery_type] || ''));

    // 处理「真正问题」- 提取枚举标签
    const realBottleneckRaw = anonymize(String(row[COLUMN_MAP.real_bottleneck] || '').trim());
    const realBottleneck = extractBottleneck(realBottleneckRaw);

    // 处理认知来源（删除具体人名）
    const cognitionSource = anonymize(String(row[COLUMN_MAP.cognition_source] || '').trim());

    const effectiveAction = anonymize(String(row[COLUMN_MAP.effective_action] || '').trim());

    // 构建案例对象
    const caseData = {
      id: generateId(industry, companySize, i + 1),
      industry,
      company_size: companySize,
      company_state: companyState,
      surface_problem: surfaceProblem,
      initial_explanation: initialExplanation,
      cognition_source: cognitionSource,
      real_bottleneck: realBottleneck,
      friction_layer: '', // v1 留空，后续补充
      recovery_type: recoveryType,
      failed_action: failedAction,
      effective_action: effectiveAction,
      key_questions: [], // v1 留空，手工补充后升级为 enriched
      adaptation_experiment: '',
      insight_confidence: 'low',
      followup_result: null,
      completeness: 'skeleton'
    };

    // 计算 insight_confidence
    caseData.insight_confidence = calculateInsightConfidence(caseData);

    // 判断补全级别
    caseData.completeness = determineCompleteness(caseData);

    // 统计
    switch (caseData.completeness) {
      case 'skeleton': skeletonCount++; break;
      case 'gap': gapCount++; break;
      case 'enriched': enrichedCount++; break;
    }

    if (caseData.insight_confidence === 'high') {
      highConfidenceCount++;
    }

    cases.push(caseData);
  }

  // 写入 caseLibrary.json
  const outputPath = path.join(__dirname, '..', 'data', 'caseLibrary.json');
  fs.writeFileSync(outputPath, JSON.stringify(cases, null, 2), 'utf-8');

  // 打印汇总
  const activeCount = gapCount + enrichedCount;

  console.log('='.repeat(60));
  console.log('导入完成');
  console.log('='.repeat(60));
  console.log(`
总条数:           ${cases.length}
├─ skeleton:      ${skeletonCount} (空壳，不参与检索)
├─ gap:           ${gapCount} (活跃库)
└─ enriched:      ${enrichedCount} (活跃库，优先级最高)

活跃库条数:       ${activeCount} ← 这才是真正可用的案例数
高置信度案例:     ${highConfidenceCount}

输出文件: ${outputPath}
`);

  if (activeCount < 10) {
    console.log('⚠️  警告: 活跃库不足10条，AI提问能力有限。');
    console.log('   建议补全更多案例的 initial_explanation、real_bottleneck、recovery_type 字段。\n');
  }

  console.log('='.repeat(60));
}

// 执行
const xlsxPath = process.argv[2];

if (!xlsxPath) {
  console.log('用法: node scripts/import.js <xlsx文件路径>');
  console.log('示例: node scripts/import.js ./企业认知决策问题数据收集表.xlsx');
  process.exit(1);
}

if (!fs.existsSync(xlsxPath)) {
  console.error(`错误: 文件不存在 - ${xlsxPath}`);
  process.exit(1);
}

importCases(xlsxPath);
