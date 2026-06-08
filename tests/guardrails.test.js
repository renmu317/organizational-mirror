/**
 * 护栏测试 - 验证收敛模块遵守核心铁律
 *
 * 测试项：
 * 1. 禁用词检测
 * 2. 反映式假设格式
 * 3. 收敛检测逻辑
 * 4. 假设确认流程
 * 5. 客户视角输出
 */

const path = require('path');

// 加载收敛模块
const convergence = require('../dist/convergence');
const { parseConfirmationReply, buildReflectiveConfirmation } = require('../prompts/consultant');

// 测试结果收集
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * 简单断言函数
 */
function assert(condition, testName, details = '') {
  if (condition) {
    results.passed++;
    results.tests.push({ name: testName, status: 'PASS', details });
    console.log(`✅ PASS: ${testName}`);
  } else {
    results.failed++;
    results.tests.push({ name: testName, status: 'FAIL', details });
    console.log(`❌ FAIL: ${testName}`);
    if (details) console.log(`   详情: ${details}`);
  }
}

/**
 * 断言相等
 */
function assertEqual(actual, expected, testName) {
  const condition = actual === expected;
  const details = condition ? '' : `期望 "${expected}", 实际 "${actual}"`;
  assert(condition, testName, details);
}

/**
 * 断言包含
 */
function assertContains(text, substring, testName) {
  const condition = text.includes(substring);
  const details = condition ? '' : `文本中未找到 "${substring}"`;
  assert(condition, testName, details);
}

/**
 * 断言不包含
 */
function assertNotContains(text, substring, testName) {
  const condition = !text.includes(substring);
  const details = condition ? '' : `文本中不应包含 "${substring}"`;
  assert(condition, testName, details);
}

// ============================================================
// 测试组 1: 禁用词检测
// ============================================================
console.log('\n========== 测试组 1: 禁用词检测 ==========\n');

const FORBIDDEN_WORDS = convergence.FORBIDDEN_WORDS;

// 1.1 验证禁用词列表存在且完整
assert(
  Array.isArray(FORBIDDEN_WORDS) && FORBIDDEN_WORDS.length >= 10,
  '禁用词列表存在且包含足够多的词',
  `当前有 ${FORBIDDEN_WORDS.length} 个禁用词`
);

// 1.2 验证核心禁用词在列表中
const coreForbidenWords = ['诊断', '专家', '决策架构', '组织共识', '瓶颈', '核心原因是'];
coreForbidenWords.forEach(word => {
  assert(
    FORBIDDEN_WORDS.includes(word),
    `禁用词列表包含 "${word}"`
  );
});

// 1.3 测试禁用词检测函数
function containsForbiddenWord(text) {
  for (const word of FORBIDDEN_WORDS) {
    if (text.includes(word)) {
      return { found: true, word };
    }
  }
  return { found: false, word: null };
}

const goodText = '照你刚才说的，听起来你现在的想法是销售问题不是根本。我理解得对吗？';
const badText = '根据诊断，你的核心原因是决策架构有问题。';

assert(
  !containsForbiddenWord(goodText).found,
  '合规文本不触发禁用词检测'
);

const badCheck = containsForbiddenWord(badText);
assert(
  badCheck.found,
  '违规文本触发禁用词检测',
  `检测到禁用词: "${badCheck.word}"`
);

// ============================================================
// 测试组 2: 反映式假设格式
// ============================================================
console.log('\n========== 测试组 2: 反映式假设格式 ==========\n');

// 2.1 验证 evaluateHypothesisQuality 函数
const goodHypothesis = {
  statement: '照你刚才说的——「我觉得不是销售的问题」——听起来你现在的想法是，可能要从产品本身找原因。我理解得对吗？',
  userPhrasing: '我觉得不是销售的问题',
  confirmedByUser: false,
  observableEvidence: ['销售数据', '客户反馈'],
  verificationMethod: '记录',
  verificationPeriodDays: 7
};

const evaluation = convergence.evaluateHypothesisQuality(goodHypothesis);
assert(
  evaluation.score >= 70,
  '合规假设获得高分',
  `得分: ${evaluation.score}`
);

// 2.2 测试必须以提问结尾
const badHypothesis1 = {
  ...goodHypothesis,
  statement: '你的问题是销售能力不足。'  // 断言式，不以提问结尾
};
const eval1 = convergence.evaluateHypothesisQuality(badHypothesis1);
assert(
  eval1.score < 70 && eval1.issues.length > 0,
  '断言式假设获得低分',
  `得分: ${eval1.score}, 问题: ${eval1.issues.join('; ')}`
);

// 2.3 测试禁止断言式表达
const badHypothesis2 = {
  ...goodHypothesis,
  statement: '核心原因是你的销售团队执行力不足，你觉得呢？'
};
const eval2 = convergence.evaluateHypothesisQuality(badHypothesis2);
assert(
  eval2.issues.some(i => i.includes('禁止的断言式表达')),
  '检测到断言式表达',
  `问题: ${eval2.issues.join('; ')}`
);

// 2.4 测试必须引用客户原话
const badHypothesis3 = {
  ...goodHypothesis,
  userPhrasing: ''  // 缺少客户原话
};
const eval3 = convergence.evaluateHypothesisQuality(badHypothesis3);
assert(
  eval3.issues.some(i => i.includes('客户原话')),
  '检测到缺少客户原话',
  `问题: ${eval3.issues.join('; ')}`
);

// 2.5 测试 buildReflectiveConfirmation 函数
const reflective = buildReflectiveConfirmation('可能问题不在销售', '要从产品找原因');
assertContains(reflective, '照你刚才说的', '反映式确认包含正确开头');
assertContains(reflective, '可能问题不在销售', '反映式确认引用客户原话');
assertContains(reflective, '我理解得对吗', '反映式确认以提问结尾');

// ============================================================
// 测试组 3: 收敛检测逻辑
// ============================================================
console.log('\n========== 测试组 3: 收敛检测逻辑 ==========\n');

// 3.1 测试空会话不触发收敛
const emptySession = convergence.createSession('测试问题', [], '测试聚焦');
const emptyResult = convergence.checkConvergenceBoundary(emptySession);
assert(
  !emptyResult.shouldStop,
  '空会话不触发收敛'
);

// 3.2 测试深度限制（3层后停止）
const session3Questions = convergence.createSession('测试问题', [], '测试聚焦');
convergence.startNewChain(session3Questions, '测试聚焦');

// 添加3个问题
for (let i = 1; i <= 3; i++) {
  convergence.addQuestionRecord(session3Questions, {
    depth: i,
    question: `问题${i}`,
    userAnswer: `回答${i}`,
    attributionShifted: false,
    emergingHypothesis: '',
    convergenceScore: 0.3
  });
}

const depth3Result = convergence.checkConvergenceBoundary(session3Questions);
assert(
  depth3Result.shouldStop && depth3Result.reason === 'DEPTH_LIMIT_REACHED',
  '3层问题后触发深度限制停止',
  `原因: ${depth3Result.reason}`
);

// 3.3 测试真收敛（三个条件同时满足）
const convergingSession = convergence.createSession('测试问题', [], '测试聚焦');
convergence.startNewChain(convergingSession, '测试聚焦');

// 添加一个高收敛分数的问题
convergence.addQuestionRecord(convergingSession, {
  depth: 2,
  question: '如果销售更努力，问题就解决了吗？',
  userAnswer: '我现在觉得可能不是销售的问题',
  attributionShifted: true,
  emergingHypothesis: '问题可能在产品定价',
  convergenceScore: 0.8
});

const convergedResult = convergence.checkConvergenceBoundary(convergingSession);
assert(
  convergedResult.shouldStop && convergedResult.reason === 'HYPOTHESIS_EMERGED',
  '真收敛触发假设浮现停止',
  `原因: ${convergedResult.reason}, readyForHypothesis: ${convergedResult.readyForHypothesis}`
);

// 3.4 测试收敛分数计算
const score = convergence.calculateConvergenceScore(convergingSession);
assert(
  score >= 0.7,
  '高收敛会话的分数 >= 0.7',
  `实际分数: ${score}`
);

// ============================================================
// 测试组 4: 假设确认流程
// ============================================================
console.log('\n========== 测试组 4: 假设确认流程 ==========\n');

// 4.1 测试确认回复解析 - 确认
const confirmResult1 = parseConfirmationReply('是的，你理解得很准确');
assert(confirmResult1.isConfirmation, '识别确认回复: "是的"');

const confirmResult2 = parseConfirmationReply('对，就是这样');
assert(confirmResult2.isConfirmation, '识别确认回复: "对"');

// 4.2 测试确认回复解析 - 否定
const negateResult1 = parseConfirmationReply('不是，我觉得问题在于...');
assert(negateResult1.isNegation, '识别否定回复: "不是"');

const negateResult2 = parseConfirmationReply('不太对，其实我想说的是...');
assert(negateResult2.isNegation, '识别否定回复: "不太对"');

// 4.3 测试确认回复解析 - 修正
const modifyResult = parseConfirmationReply('有点偏，我的意思是产品质量而不是定价');
assert(
  modifyResult.isNegation && modifyResult.modification,
  '识别修正回复并提取修正内容'
);

// 4.4 测试 processHypothesisConfirmation
const sessionWithHypothesis = convergence.createSession('测试', [], '测试');
sessionWithHypothesis.hypothesis = {
  statement: '你的想法是...',
  userPhrasing: '测试原话',
  confirmedByUser: false,
  observableEvidence: [],
  verificationMethod: '',
  verificationPeriodDays: 7
};

// 确认假设
const confirmProcessResult = convergence.processHypothesisConfirmation(sessionWithHypothesis, true);
assert(
  !confirmProcessResult.needsContinue && sessionWithHypothesis.hypothesis.confirmedByUser,
  '确认假设后 confirmedByUser = true'
);
assertEqual(
  sessionWithHypothesis.stopReason,
  'USER_CONFIRMED',
  '确认假设后 stopReason = USER_CONFIRMED'
);

// ============================================================
// 测试组 5: 客户视角输出
// ============================================================
console.log('\n========== 测试组 5: 客户视角输出 ==========\n');

// 5.1 测试 generateBriefSummary 使用"你"
const summarySession = convergence.createSession('利润下降', ['员工流失'], '利润问题');
summarySession.hypothesis = {
  statement: '你的想法是利润下降可能不是销售问题',
  userPhrasing: '我觉得可能不是销售',
  confirmedByUser: true,
  observableEvidence: ['数据1'],
  verificationMethod: '观察',
  verificationPeriodDays: 7
};

const briefSummary = convergence.generateBriefSummary(summarySession);
assertContains(briefSummary, '你', '简洁摘要使用"你"');
assertNotContains(briefSummary, '客户', '简洁摘要不使用"客户"');
assertNotContains(briefSummary, '用户', '简洁摘要不使用"用户"');

// 5.2 测试 getStopReasonDescription 不使用专业术语
const reasons = ['HYPOTHESIS_EMERGED', 'DEPTH_LIMIT_REACHED', 'USER_CONFIRMED', 'INSUFFICIENT_EVIDENCE'];
reasons.forEach(reason => {
  const description = convergence.getStopReasonDescription(reason);
  assertNotContains(description, '诊断', `停止原因描述不包含"诊断": ${reason}`);
  assertNotContains(description, '专家', `停止原因描述不包含"专家": ${reason}`);
});

// ============================================================
// 测试结果汇总
// ============================================================
console.log('\n========== 测试结果汇总 ==========\n');
console.log(`总计: ${results.passed + results.failed} 个测试`);
console.log(`通过: ${results.passed} ✅`);
console.log(`失败: ${results.failed} ❌`);

if (results.failed > 0) {
  console.log('\n失败的测试:');
  results.tests
    .filter(t => t.status === 'FAIL')
    .forEach(t => console.log(`  - ${t.name}: ${t.details}`));
  process.exit(1);
} else {
  console.log('\n🎉 所有护栏测试通过！');
  process.exit(0);
}
