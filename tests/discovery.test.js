/**
 * 发现式对话架构测试 (v7 AI驱动版)
 *
 * v7 测试重点:
 * - 确定性判断函数（模糊/过短/假设触发词/终结信号）
 * - 系统提示词核心内容
 * - 案例灵感构建
 *
 * 注意：v7 将 path/cognition_layer/causal_chain 等判断职责交给 AI，
 *      JS 端只保留确定性判断，因此相关测试已简化。
 */

const assert = require('assert');
const {
  DISCOVERY_SYSTEM_PROMPT,
  VAGUE_SIGNALS,
  ASSUMPTION_TRIGGERS,
  RETROSPECTIVE_SIGNALS,
  detectVagueResponse,
  isResponseTooShort,
  shouldProbeAssumption,
  detectRetrospective,
  extractMissingVariables,
  buildCaseHints,
  parseConfirmationReply,
  buildSystemPrompt,
  getOpeningMessage
} = require('../prompts/consultant');

// ============================================================
// 简单测试运行器
// ============================================================
const results = { passed: 0, failed: 0, errors: [] };

function describe(suiteName, fn) {
  console.log(`\n${suiteName}`);
  fn();
}

function test(testName, fn) {
  try {
    fn();
    console.log(`  ✓ ${testName}`);
    results.passed++;
  } catch (error) {
    console.log(`  ✗ ${testName}`);
    console.log(`    Error: ${error.message}`);
    results.failed++;
    results.errors.push({ testName, error: error.message });
  }
}

// ============================================================
// 运行测试
// ============================================================
console.log('='.repeat(60));
console.log('v7 AI驱动架构测试');
console.log('='.repeat(60));

// ============================================================
// 测试: 模糊信号检测
// ============================================================
describe('模糊信号检测', () => {
  test('「不知道」应检测为模糊', () => {
    assert.strictEqual(detectVagueResponse('不知道怎么回答'), true);
  });

  test('「说不清」应检测为模糊', () => {
    assert.strictEqual(detectVagueResponse('这个说不清'), true);
  });

  test('「不太确定」应检测为模糊', () => {
    assert.strictEqual(detectVagueResponse('不太确定这个数字'), true);
  });

  test('具体回复不应为模糊', () => {
    assert.strictEqual(detectVagueResponse('去年三月份客户增加了30%'), false);
  });

  test('所有模糊信号词都应被检测', () => {
    VAGUE_SIGNALS.forEach(signal => {
      const result = detectVagueResponse(`我${signal}`);
      assert.strictEqual(result, true, `应检测到 "${signal}"`);
    });
  });
});

// ============================================================
// 测试: 过短回复检测
// ============================================================
describe('过短回复检测', () => {
  test('少于10字符应为过短', () => {
    assert.strictEqual(isResponseTooShort('是'), true);
    assert.strictEqual(isResponseTooShort('好的'), true);
    assert.strictEqual(isResponseTooShort('不知道'), true);
  });

  test('超过10字符不应为过短', () => {
    assert.strictEqual(isResponseTooShort('去年三月份客户增加了30%'), false);
  });
});

// ============================================================
// 测试: 假设触发词检测
// ============================================================
describe('假设触发词检测', () => {
  test('应检测"必须"触发词', () => {
    assert.strictEqual(shouldProbeAssumption('做产品必须这样'), true);
  });

  test('应检测"只能"触发词', () => {
    assert.strictEqual(shouldProbeAssumption('只能先做再说'), true);
  });

  test('应检测"没办法"触发词', () => {
    assert.strictEqual(shouldProbeAssumption('没办法，市场就这样'), true);
  });

  test('应检测"不可能"触发词', () => {
    assert.strictEqual(shouldProbeAssumption('不可能换方向'), true);
  });

  test('应检测"当然"触发词', () => {
    assert.strictEqual(shouldProbeAssumption('当然要先做产品'), true);
  });

  test('普通话不应触发', () => {
    assert.strictEqual(shouldProbeAssumption('我们去年做了一些调整'), false);
  });

  test('所有假设触发词都应被检测', () => {
    ASSUMPTION_TRIGGERS.forEach(trigger => {
      const result = shouldProbeAssumption(`${trigger}这样做`);
      assert.strictEqual(result, true, `应检测到 "${trigger}"`);
    });
  });
});

// ============================================================
// 测试: 终结信号检测（retrospective）
// ============================================================
describe('终结信号检测', () => {
  test('「已经倒闭」应检测为终结', () => {
    assert.strictEqual(detectRetrospective('公司已经倒闭了'), true);
  });

  test('「公司没了」应检测为终结', () => {
    assert.strictEqual(detectRetrospective('那家公司没了'), true);
  });

  test('「当年」应检测为终结', () => {
    assert.strictEqual(detectRetrospective('当年我们做了一个决定'), true);
  });

  test('「破产」应检测为终结', () => {
    assert.strictEqual(detectRetrospective('最后破产了'), true);
  });

  test('正常运营不应检测为终结', () => {
    assert.strictEqual(detectRetrospective('客户在流失，利润下降'), false);
  });

  test('所有终结信号词都应被检测', () => {
    RETROSPECTIVE_SIGNALS.forEach(signal => {
      const result = detectRetrospective(`${signal}`);
      assert.strictEqual(result, true, `应检测到 "${signal}"`);
    });
  });
});

// ============================================================
// 测试: 缺失变量提取
// ============================================================
describe('缺失变量提取', () => {
  test('应从定价相关案例中提取定价策略', () => {
    const variables = extractMissingVariables({
      real_bottleneck: '定价策略不合理',
      initial_explanation: '销售不够努力'
    });
    assert(variables.includes('定价策略'), '应包含定价策略');
  });

  test('应从决策相关案例中提取决策周期', () => {
    const variables = extractMissingVariables({
      real_bottleneck: '决策周期太长',
      initial_explanation: '销售不够'
    });
    assert(variables.includes('决策周期'), '应包含决策周期');
  });

  test('应从现金流相关案例中提取现金流结构', () => {
    const variables = extractMissingVariables({
      real_bottleneck: '现金流紧张导致运营困难',
      initial_explanation: '销量不够'
    });
    assert(variables.includes('现金流结构'), '应包含现金流结构');
  });

  test('无法提取时应返回通用变量', () => {
    const variables = extractMissingVariables({
      real_bottleneck: '',
      initial_explanation: ''
    });
    assert(variables.length > 0, '应返回通用变量');
  });
});

// ============================================================
// 测试: 案例灵感构建
// ============================================================
describe('案例灵感构建', () => {
  test('应只提供缺失变量，不提供答案', () => {
    const cases = [{
      initial_explanation: '销售不够努力',
      real_bottleneck: '定价策略不合理'
    }];
    const hints = buildCaseHints(cases);

    assert(hints.length > 0, '应生成灵感');
    assert(hints[0].missing_variables, '应包含缺失变量');
    assert(!hints[0].answer, '不应包含直接答案');
  });

  test('应提取认知缺口', () => {
    const cases = [{
      initial_explanation: '团队执行力差',
      real_bottleneck: '战略方向错误'
    }];
    const hints = buildCaseHints(cases);

    assert(hints[0].cognitive_gap, '应包含认知缺口');
    assert(hints[0].cognitive_gap.includes('团队执行力差'), '缺口应包含初始解释');
    assert(hints[0].cognitive_gap.includes('战略方向错误'), '缺口应包含真实瓶颈');
  });
});

// ============================================================
// 测试: 确认回复解析
// ============================================================
describe('确认回复解析', () => {
  test('应识别肯定确认', () => {
    const result = parseConfirmationReply('是的，我同意');
    assert.strictEqual(result.isConfirmation, true);
    assert.strictEqual(result.isNegation, false);
  });

  test('应识别否定', () => {
    const result = parseConfirmationReply('不是这样的，其实...');
    assert.strictEqual(result.isNegation, true);
    assert.strictEqual(result.isConfirmation, false);
  });

  test('否定时应保留修正内容', () => {
    const input = '不对，应该是市场变化';
    const result = parseConfirmationReply(input);
    assert.strictEqual(result.modification, input);
  });
});

// ============================================================
// 测试: 系统提示词核心内容
// ============================================================
describe('系统提示词核心内容', () => {
  test('应包含禁用词列表', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('绝对禁止的词汇'), '应包含禁用词标题');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('诊断'), '应列出诊断');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('你应该'), '应列出你应该');
  });

  test('应包含唯一主线', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('唯一主线'), '应包含唯一主线');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('世界规则'), '应包含世界规则');
  });

  test('应包含开场分流规则', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('开场分流'), '应包含开场分流');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('early'), '应包含early');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('org'), '应包含org');
  });

  test('应包含六层认知链', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('六层'), '应包含六层');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('result'), '应包含result');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('rule'), '应包含rule');
  });

  test('应包含三条铁律', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('三条铁律'), '应包含三条铁律');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('行动答案'), '应包含行动答案');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('反向追问'), '应包含反向追问');
  });

  test('应包含 actionable vs retrospective 分支', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('actionable'), '应包含actionable');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('retrospective'), '应包含retrospective');
  });

  test('应包含 L3 红线规则', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('L3 红线'), '应包含L3红线');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('fact'), '应包含fact');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('attribution'), '应包含attribution');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('definition'), '应包含definition');
  });

  test('应包含三级提示机制', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('三级提示'), '应包含三级提示');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('L1'), '应包含L1');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('L2'), '应包含L2');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('L3'), '应包含L3');
  });

  test('应包含软上限而非强制收尾', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('软上限'), '应包含软上限');
    // 注意：提示词中有"没有...必须出实验卡...这种硬指令"，是否定语境
    assert(DISCOVERY_SYSTEM_PROMPT.includes('没有'), '应明确说明没有强制指令');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('硬指令'), '应提到硬指令');
  });

  test('应包含 JSON 输出格式', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('cognition_layer'), '应包含cognition_layer');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('world_rule'), '应包含world_rule');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('session_complete'), '应包含session_complete');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('branch'), '应包含branch');
  });
});

// ============================================================
// 测试: 开场白
// ============================================================
describe('开场白', () => {
  test('应返回正确格式', () => {
    const opening = getOpeningMessage();
    assert(opening.reply, '应包含reply');
    assert.strictEqual(opening.path, 'unknown');
    assert.strictEqual(opening.session_complete, false);
    assert.strictEqual(opening.branch, null);
  });

  test('开场白应包含核心问题', () => {
    const opening = getOpeningMessage();
    assert(opening.reply.includes('挑战'), '应询问挑战');
  });
});

// ============================================================
// 测试: buildSystemPrompt
// ============================================================
describe('buildSystemPrompt', () => {
  test('无状态时应返回基础提示词', () => {
    const prompt = buildSystemPrompt([], null);
    assert(prompt.includes('唯一主线'), '应包含核心内容');
  });

  test('有状态时应注入状态信息', () => {
    const state = {
      path: 'org',
      branch: 'actionable',
      stage: 2,
      total_turns: 5,
      difficulty: 'L1',
      causalChain: ['A', 'B'],
      cognition_layer: 'decision',
      deepest_layer_reached: 'assumption',
      shallow_streak: 1,
      world_rule: ''
    };
    const prompt = buildSystemPrompt([], state);
    assert(prompt.includes('当前会话状态'), '应包含状态标题');
    assert(prompt.includes('org'), '应包含路径');
    assert(prompt.includes('A → B'), '应包含因果链');
  });

  test('retrospective 分支应添加提醒', () => {
    const state = {
      path: 'org',
      branch: 'retrospective',
      stage: 3,
      total_turns: 8
    };
    const prompt = buildSystemPrompt([], state);
    assert(prompt.includes('仅复盘'), '应包含仅复盘提醒');
    assert(prompt.includes('不要出实验卡'), '应包含不出实验卡提醒');
  });

  test('浅层连续应添加提示', () => {
    const state = {
      path: 'org',
      shallow_streak: 3
    };
    const prompt = buildSystemPrompt([], state);
    assert(prompt.includes('连续'), '应包含连续浅层提示');
  });

  test('案例灵感应仅在 org Stage3+ 注入', () => {
    const cases = [{
      initial_explanation: '销售问题',
      real_bottleneck: '定价问题'
    }];
    const hints = buildCaseHints(cases);

    // Stage 2 不应注入
    const state2 = { path: 'org', stage: 2 };
    const prompt2 = buildSystemPrompt(hints, state2);
    assert(!prompt2.includes('缺失变量灵感'), 'Stage2 不应包含灵感');

    // Stage 3 应注入
    const state3 = { path: 'org', stage: 3 };
    const prompt3 = buildSystemPrompt(hints, state3);
    assert(prompt3.includes('缺失变量灵感'), 'Stage3 应包含灵感');
  });
});

// ============================================================
// 输出结果
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`测试完成: ${results.passed} 通过, ${results.failed} 失败`);

if (results.failed > 0) {
  console.log('\n失败的测试:');
  results.errors.forEach(e => {
    console.log(`  - ${e.testName}: ${e.error}`);
  });
}

console.log('='.repeat(60));

// 退出码
process.exit(results.failed > 0 ? 1 : 0);
