/**
 * 发现式对话架构测试 (v3 双路径)
 *
 * 测试:
 * - 开场分流 (early/org)
 * - 难度降级 (L1/L2/L3)
 * - L3红线 (只有fact题可用选项)
 * - 收敛封顶
 */

const assert = require('assert');
const {
  DISCOVERY_SYSTEM_PROMPT,
  VAGUE_SIGNALS,
  EARLY_PATH_SIGNALS,
  ORG_PATH_SIGNALS,
  CURIOSITY_SIGNALS,
  CAUSAL_SIGNALS,
  STORY_SIGNALS,
  detectPath,
  detectVagueResponse,
  isResponseTooShort,
  detectBehavioralSignal,
  extractCausalChain,
  extractMissingVariables,
  buildCaseHints,
  parseConfirmationReply
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
console.log('v3 双路径架构测试');
console.log('='.repeat(60));

// 测试1: 路径分流 - early
describe('开场分流 - early路径', () => {
  test('「没有客户」应判为early', () => {
    const result = detectPath('商业验证阶段，没有客户');
    assert.strictEqual(result.path, 'early');
  });

  test('「还没上线」应判为early', () => {
    const result = detectPath('产品还没上线');
    assert.strictEqual(result.path, 'early');
  });

  test('「刚开始」应判为early', () => {
    const result = detectPath('我们刚开始做');
    assert.strictEqual(result.path, 'early');
  });

  test('「想法阶段」应判为early', () => {
    const result = detectPath('目前还在想法阶段');
    assert.strictEqual(result.path, 'early');
  });

  test('「没验证」应判为early', () => {
    const result = detectPath('还没有验证过需求');
    assert.strictEqual(result.path, 'early');
  });

  test('「没收入」应判为early', () => {
    const result = detectPath('目前没有收入');
    assert.strictEqual(result.path, 'early');
  });

  test('所有early信号词都应被检测', () => {
    EARLY_PATH_SIGNALS.forEach(signal => {
      const result = detectPath(`我们${signal}的`);
      assert.strictEqual(
        result.path,
        'early',
        `信号 "${signal}" 应判为early`
      );
    });
  });
});

// 测试2: 路径分流 - org
describe('开场分流 - org路径', () => {
  test('「客户流失」应判为org', () => {
    const result = detectPath('客户在流失');
    assert.strictEqual(result.path, 'org');
  });

  test('「利润下滑」应判为org', () => {
    const result = detectPath('利润一直在下滑');
    assert.strictEqual(result.path, 'org');
  });

  test('「团队问题」应判为org', () => {
    const result = detectPath('团队问题很严重');
    assert.strictEqual(result.path, 'org');
  });

  test('「已在运营」应判为org', () => {
    const result = detectPath('我们已在运营两年');
    assert.strictEqual(result.path, 'org');
  });

  test('所有org信号词都应被检测', () => {
    ORG_PATH_SIGNALS.forEach(signal => {
      const result = detectPath(`我们${signal}`);
      assert.strictEqual(
        result.path,
        'org',
        `信号 "${signal}" 应判为org`
      );
    });
  });
});

// 测试3: 路径分流 - unknown兜底
describe('开场分流 - unknown兜底', () => {
  test('模糊回复应判为unknown', () => {
    const result = detectPath('有些问题');
    assert.strictEqual(result.path, 'unknown');
  });

  test('无信号词应判为unknown', () => {
    const result = detectPath('想聊聊公司的事');
    assert.strictEqual(result.path, 'unknown');
  });
});

// 测试4: 模糊信号检测
describe('模糊信号检测', () => {
  test('「不知道」应检测为模糊', () => {
    assert.strictEqual(detectVagueResponse('我不知道'), true);
  });

  test('「说不清」应检测为模糊', () => {
    assert.strictEqual(detectVagueResponse('说不清楚'), true);
  });

  test('「不太确定」应检测为模糊', () => {
    assert.strictEqual(detectVagueResponse('不太确定'), true);
  });

  test('具体回复不应为模糊', () => {
    assert.strictEqual(detectVagueResponse('销售下降了30%'), false);
  });

  test('所有模糊信号词都应被检测', () => {
    VAGUE_SIGNALS.forEach(signal => {
      assert.strictEqual(
        detectVagueResponse(signal),
        true,
        `"${signal}" 应被检测为模糊`
      );
    });
  });
});

// 测试5: 过短回复检测
describe('过短回复检测', () => {
  test('少于10字符应为过短', () => {
    assert.strictEqual(isResponseTooShort('不知道'), true);
  });

  test('超过10字符不应为过短', () => {
    assert.strictEqual(isResponseTooShort('销售额从去年Q3开始下降'), false);
  });
});

// 测试6: 好奇心信号检测
describe('好奇心信号检测', () => {
  test('应检测到「我没想过」', () => {
    const result = detectBehavioralSignal('这个我没想过，确实有意思', 'CURIOSITY');
    assert.strictEqual(result.detected, true);
  });

  test('应检测到「有意思」', () => {
    const result = detectBehavioralSignal('有意思，这个角度我没考虑过', 'CURIOSITY');
    assert.strictEqual(result.detected, true);
  });

  test('应检测到「真的吗」', () => {
    const result = detectBehavioralSignal('真的吗？我一直以为不是这样', 'CURIOSITY');
    assert.strictEqual(result.detected, true);
  });

  test('普通回答不应触发好奇心信号', () => {
    const result = detectBehavioralSignal('你说的对，我同意这个观点', 'CURIOSITY');
    assert.strictEqual(result.detected, false);
  });

  test('所有好奇心信号词都应被检测', () => {
    CURIOSITY_SIGNALS.forEach(signal => {
      const result = detectBehavioralSignal(`这个${signal}`, 'CURIOSITY');
      assert.strictEqual(
        result.detected,
        true,
        `信号 "${signal}" 应被检测到`
      );
    });
  });
});

// 测试7: 故事完成信号检测
describe('故事完成信号检测', () => {
  test('包含时间词应触发故事完成', () => {
    const result = detectBehavioralSignal('从去年开始销售就一直在下降', 'STORY_COMPLETE');
    assert.strictEqual(result.detected, true);
  });

  test('包含数字应触发故事完成', () => {
    const result = detectBehavioralSignal('利润下降了30%', 'STORY_COMPLETE');
    assert.strictEqual(result.detected, true);
  });

  test('包含具体事件应触发故事完成', () => {
    const result = detectBehavioralSignal('上个月我们丢了最大的客户', 'STORY_COMPLETE');
    assert.strictEqual(result.detected, true);
  });

  test('模糊描述不应触发故事完成', () => {
    const result = detectBehavioralSignal('我们有一些问题', 'STORY_COMPLETE');
    assert.strictEqual(result.detected, false);
  });
});

// 测试8: 因果链完成信号检测
describe('因果链信号检测', () => {
  test('包含「导致」应触发因果链信号', () => {
    const result = detectBehavioralSignal('销售下降导致了利润减少', 'CAUSAL_CHAIN_DONE');
    assert.strictEqual(result.detected, true);
  });

  test('包含「所以」应触发因果链信号', () => {
    const result = detectBehavioralSignal('因为客户流失，所以收入下降了', 'CAUSAL_CHAIN_DONE');
    assert.strictEqual(result.detected, true);
  });

  test('无因果词不应触发', () => {
    const result = detectBehavioralSignal('我们需要更多的销售', 'CAUSAL_CHAIN_DONE');
    assert.strictEqual(result.detected, false);
  });
});

// 测试9: 用户问题检测
describe('用户问题检测', () => {
  test('包含问号应检测到问题', () => {
    const result = detectBehavioralSignal('那如果不是销售问题，会是什么？', 'USER_QUESTION');
    assert.strictEqual(result.detected, true);
  });

  test('陈述句不应检测为问题', () => {
    const result = detectBehavioralSignal('我认为这是个好想法', 'USER_QUESTION');
    assert.strictEqual(result.detected, false);
  });
});

// 测试10: 因果链提取
describe('因果链提取', () => {
  test('应提取用「导致」连接的因果链', () => {
    const chain = extractCausalChain('销售下降导致利润下降，导致现金流紧张');
    assert(chain.length >= 2, '应提取至少2个环节');
    assert(chain.some(c => c.includes('销售')));
  });

  test('应提取用「因为...所以...」连接的因果链', () => {
    const chain = extractCausalChain('因为客户流失，所以收入减少了');
    assert(chain.length >= 2, '应提取至少2个环节');
  });

  test('无因果关系的文本应返回空数组', () => {
    const chain = extractCausalChain('我们公司有一些问题');
    assert.strictEqual(chain.length, 0);
  });
});

// 测试11: 缺失变量提取
describe('缺失变量提取', () => {
  test('应从定价相关案例中提取定价策略', () => {
    const caseData = {
      initial_explanation: '销售不好',
      real_bottleneck: '定价策略有问题'
    };
    const vars = extractMissingVariables(caseData);
    assert(vars.includes('定价策略'));
  });

  test('应从决策相关案例中提取决策周期', () => {
    const caseData = {
      initial_explanation: '执行不力',
      real_bottleneck: '决策周期太长'
    };
    const vars = extractMissingVariables(caseData);
    assert(vars.includes('决策周期'));
  });

  test('应从现金流相关案例中提取现金流结构', () => {
    const caseData = {
      initial_explanation: '利润下降',
      real_bottleneck: '现金流结构问题'
    };
    const vars = extractMissingVariables(caseData);
    assert(vars.includes('现金流结构'));
  });

  test('无法提取时应返回通用变量', () => {
    const caseData = {
      initial_explanation: 'xxx',
      real_bottleneck: 'yyy'
    };
    const vars = extractMissingVariables(caseData);
    assert(vars.length > 0, '应至少返回一个变量');
  });
});

// 测试12: 确认回复解析
describe('确认回复解析', () => {
  test('应识别肯定确认', () => {
    const confirmations = ['是', '对', '没错', '是的', '对的', '确实'];
    confirmations.forEach(reply => {
      const result = parseConfirmationReply(reply);
      assert.strictEqual(
        result.isConfirmation,
        true,
        `"${reply}" 应被识别为确认`
      );
    });
  });

  test('应识别否定', () => {
    const negations = ['不是', '不对', '不太对', '其实不是这样'];
    negations.forEach(reply => {
      const result = parseConfirmationReply(reply);
      assert.strictEqual(
        result.isNegation,
        true,
        `"${reply}" 应被识别为否定`
      );
    });
  });

  test('否定时应保留修正内容', () => {
    const result = parseConfirmationReply('其实不是这样，我觉得是那样');
    assert.strictEqual(result.isNegation, true);
    assert(result.modification.includes('那样'));
  });
});

// 测试13: 案例灵感构建
describe('案例灵感构建（v3）', () => {
  test('应只提供缺失变量，不提供答案', () => {
    const cases = [{
      initial_explanation: '销售下降',
      real_bottleneck: '定价策略问题',
      insight_confidence: 'high'
    }];

    const hints = buildCaseHints(cases);

    assert.strictEqual(hints.length, 1);
    assert(hints[0].missing_variables, '应有缺失变量');
    assert(Array.isArray(hints[0].missing_variables));
    // 不应直接暴露 real_bottleneck 作为答案
    assert(!hints[0].real_bottleneck, '不应直接暴露答案');
  });

  test('应提取认知缺口', () => {
    const cases = [{
      initial_explanation: '市场不好',
      real_bottleneck: '内部流程问题'
    }];

    const hints = buildCaseHints(cases);

    assert(hints[0].cognitive_gap, '应有认知缺口');
    assert(hints[0].cognitive_gap.includes('市场不好'));
    assert(hints[0].cognitive_gap.includes('内部流程问题'));
  });
});

// 测试14: 禁用词检测
describe('禁用词', () => {
  const FORBIDDEN_WORDS = [
    '诊断', '专家', '建议', '策略', '方案', '解决方案',
    '你错了', '你应该'
  ];

  test('系统提示词中包含禁用词列表', () => {
    FORBIDDEN_WORDS.forEach(word => {
      assert(
        DISCOVERY_SYSTEM_PROMPT.includes(word),
        `禁用词 "${word}" 应该在系统提示词的禁用列表中`
      );
    });
  });
});

// 测试15: 双路径阶段定义
describe('双路径阶段定义', () => {
  test('系统提示词应包含early路径', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('early'), '应包含early路径');
  });

  test('系统提示词应包含org路径', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('org'), '应包含org路径');
  });

  test('系统提示词应包含E1-E4阶段', () => {
    ['E1', 'E2', 'E3', 'E4'].forEach(stage => {
      assert(DISCOVERY_SYSTEM_PROMPT.includes(stage), `应包含 ${stage}`);
    });
  });

  test('系统提示词应包含Stage 1-6', () => {
    for (let i = 1; i <= 6; i++) {
      assert(DISCOVERY_SYSTEM_PROMPT.includes(`Stage ${i}`), `应包含 Stage ${i}`);
    }
  });
});

// 测试16: L3红线规则
describe('L3红线规则', () => {
  test('系统提示词应包含question_kind定义', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('question_kind'), '应包含question_kind');
  });

  test('系统提示词应包含fact/attribution/definition', () => {
    assert(DISCOVERY_SYSTEM_PROMPT.includes('fact'), '应包含fact');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('attribution'), '应包含attribution');
    assert(DISCOVERY_SYSTEM_PROMPT.includes('definition'), '应包含definition');
  });

  test('系统提示词应说明只有fact题可用L3选项', () => {
    assert(
      DISCOVERY_SYSTEM_PROMPT.includes('fact') &&
      DISCOVERY_SYSTEM_PROMPT.includes('L3'),
      '应说明L3规则'
    );
  });
});

// 测试17: 撞击式提问规则
describe('撞击式提问', () => {
  test('系统提示词应禁止空问法', () => {
    assert(
      DISCOVERY_SYSTEM_PROMPT.includes('禁止') ||
      DISCOVERY_SYSTEM_PROMPT.includes('空问'),
      '应包含空问法禁止规则'
    );
  });

  test('系统提示词应要求撞击式提问', () => {
    assert(
      DISCOVERY_SYSTEM_PROMPT.includes('撞击') ||
      DISCOVERY_SYSTEM_PROMPT.includes('涨') ||
      DISCOVERY_SYSTEM_PROMPT.includes('跌'),
      '应包含撞击式提问要求'
    );
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
  process.exit(1);
}

console.log('='.repeat(60));
