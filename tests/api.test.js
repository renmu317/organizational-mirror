/**
 * API 集成测试 - 验证收敛模块 API 端点
 *
 * 测试项：
 * 1. /api/converge/start
 * 2. /api/converge/select-focus
 * 3. /api/converge/answer
 * 4. /api/converge/confirm-hypothesis
 * 5. /api/converge/generate-output
 * 6. /api/respond (集成收敛)
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

// 测试结果收集
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
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

function skip(testName, reason) {
  results.skipped++;
  results.tests.push({ name: testName, status: 'SKIP', details: reason });
  console.log(`⏭️ SKIP: ${testName} - ${reason}`);
}

/**
 * HTTP 请求辅助函数
 */
async function post(endpoint, body) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return {
      ok: response.ok,
      status: response.status,
      data: await response.json()
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function get(endpoint) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`);
    return {
      ok: response.ok,
      status: response.status,
      data: await response.json()
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ============================================================
// 测试用例
// ============================================================

async function testHealthCheck() {
  console.log('\n========== 测试: 健康检查 ==========\n');

  const res = await get('/api/health');
  assert(res.ok, 'API 健康检查返回 200');
  assert(res.data?.status === 'ok', 'API 状态为 ok');
  assert(res.data?.convergenceModuleLoaded === true, '收敛模块已加载');

  return res.ok;
}

async function testConvergeStart() {
  console.log('\n========== 测试: /api/converge/start ==========\n');

  // 1. 正常请求
  const res1 = await post('/api/converge/start', {
    symptoms: ['销售下降', '员工流失', '利润下滑']
  });
  assert(res1.ok, '正常请求返回 200');
  assert(res1.data?.sessionId?.startsWith('CONV-'), '返回有效的 sessionId');
  assert(res1.data?.primarySymptom, '返回 primarySymptom');
  assert(res1.data?.needsFocusSelection === true, '需要选择聚焦');

  // 2. 空 symptoms 应返回错误
  const res2 = await post('/api/converge/start', { symptoms: [] });
  assert(!res2.ok || res2.data?.error, '空 symptoms 返回错误');

  // 3. 缺少 symptoms 应返回错误
  const res3 = await post('/api/converge/start', {});
  assert(!res3.ok || res3.data?.error, '缺少 symptoms 返回错误');

  return res1.data?.sessionId;
}

async function testConvergeSelectFocus(sessionId) {
  console.log('\n========== 测试: /api/converge/select-focus ==========\n');

  if (!sessionId) {
    skip('选择聚焦测试', '没有有效的 sessionId');
    return null;
  }

  // 1. 正常选择
  const res1 = await post('/api/converge/select-focus', {
    sessionId,
    selectedFocus: '销售下降'
  });
  assert(res1.ok, '正常选择聚焦返回 200');
  assert(res1.data?.success === true, '选择成功');
  assert(res1.data?.firstQuestion, '返回第一个问题');

  // 2. 验证问题不包含禁用词
  const FORBIDDEN = ['诊断', '专家', '决策架构', '瓶颈', '核心原因是'];
  const question = res1.data?.firstQuestion || '';
  let hasForbidden = false;
  for (const word of FORBIDDEN) {
    if (question.includes(word)) {
      hasForbidden = true;
      break;
    }
  }
  assert(!hasForbidden, '第一个问题不包含禁用词');

  return res1.ok;
}

async function testConvergeAnswer(sessionId) {
  console.log('\n========== 测试: /api/converge/answer ==========\n');

  if (!sessionId) {
    skip('回答测试', '没有有效的 sessionId');
    return;
  }

  // 1. 第一个回答
  const res1 = await post('/api/converge/answer', {
    sessionId,
    answer: '我觉得是销售团队不够努力，竞争对手都在增长'
  });
  assert(res1.ok, '第一个回答返回 200');
  assert(res1.data?.currentDepth >= 1, '返回当前深度');
  assert(typeof res1.data?.convergenceProgress === 'number', '返回收敛进度');

  // 2. 第二个回答
  if (res1.data?.nextQuestion) {
    const res2 = await post('/api/converge/answer', {
      sessionId,
      answer: '加大了激励，但效果不明显，我现在不确定是不是销售的问题了'
    });
    assert(res2.ok, '第二个回答返回 200');
  }

  // 3. 第三个回答（应该触发停止）
  const res3 = await post('/api/converge/answer', {
    sessionId,
    answer: '说实话，我觉得可能问题不在销售本身，可能是产品定位的问题'
  });
  assert(res3.ok, '第三个回答返回 200');

  // 检查是否达到假设阶段
  if (res3.data?.shouldStop) {
    assert(true, '达到停止条件');
    if (res3.data?.readyForHypothesis) {
      assert(res3.data?.hypothesis, '返回待确认的假设');

      // 验证假设格式
      const hypothesis = res3.data?.hypothesis;
      if (hypothesis?.statement) {
        const endsWithQuestion = hypothesis.statement.endsWith('吗？') ||
                                  hypothesis.statement.endsWith('呢？');
        assert(endsWithQuestion, '假设以提问结尾');
      }
    }
  }
}

async function testConvergeConfirmHypothesis(sessionId) {
  console.log('\n========== 测试: /api/converge/confirm-hypothesis ==========\n');

  if (!sessionId) {
    skip('确认假设测试', '没有有效的 sessionId');
    return;
  }

  // 1. 确认假设
  const res1 = await post('/api/converge/confirm-hypothesis', {
    sessionId,
    confirmed: true
  });

  if (res1.data?.error?.includes('没有待确认的假设')) {
    skip('确认假设', '会话中没有待确认的假设');
    return;
  }

  assert(res1.ok, '确认假设返回 200');
  if (res1.data?.confirmed) {
    assert(res1.data?.message, '确认成功返回消息');
  }
}

async function testRespondWithConvergence() {
  console.log('\n========== 测试: /api/respond (集成收敛) ==========\n');

  // 1. 开场白
  const res1 = await post('/api/respond', {
    history: [],
    page: 1
  });
  assert(res1.ok, '开场白返回 200');
  assert(res1.data?.sessionId, '返回 sessionId');
  assert(res1.data?.reply, '返回 reply');

  const sessionId = res1.data?.sessionId;

  // 2. Page 2 对话（应该有 convergence_progress）
  const res2 = await post('/api/respond', {
    history: [
      { role: 'assistant', content: res1.data.reply },
      { role: 'user', content: '公司利润下降了30%' }
    ],
    page: 2,
    sessionId
  });
  assert(res2.ok, 'Page 2 对话返回 200');
  assert(typeof res2.data?.convergence_progress === 'number', 'Page 2 返回 convergence_progress');

  // 3. 验证回复不包含禁用词
  const FORBIDDEN = ['诊断', '专家', '决策架构', '核心原因是'];
  const reply = res2.data?.reply || '';
  let hasForbidden = false;
  for (const word of FORBIDDEN) {
    if (reply.includes(word)) {
      hasForbidden = true;
      break;
    }
  }
  assert(!hasForbidden, '回复不包含禁用词');
}

async function testSessionDetails(sessionId) {
  console.log('\n========== 测试: /api/converge/session/:id ==========\n');

  if (!sessionId) {
    skip('会话详情测试', '没有有效的 sessionId');
    return;
  }

  const res = await get(`/api/converge/session/${sessionId}`);
  assert(res.ok, '获取会话详情返回 200');
  assert(res.data?.sessionId === sessionId, '返回正确的 sessionId');
  assert(typeof res.data?.convergenceProgress === 'number', '返回 convergenceProgress');
}

// ============================================================
// 运行测试
// ============================================================

async function runTests() {
  console.log('========================================');
  console.log('       收敛模块 API 集成测试');
  console.log('========================================');
  console.log(`目标: ${BASE_URL}`);

  // 检查服务器是否运行
  const healthOk = await testHealthCheck();
  if (!healthOk) {
    console.log('\n❌ 服务器未运行，跳过其余测试');
    console.log('请先运行: npm start');
    process.exit(1);
  }

  // 运行收敛 API 测试
  const sessionId = await testConvergeStart();
  await testConvergeSelectFocus(sessionId);
  await testConvergeAnswer(sessionId);
  await testConvergeConfirmHypothesis(sessionId);
  await testSessionDetails(sessionId);

  // 运行集成测试
  await testRespondWithConvergence();

  // 汇总结果
  console.log('\n========== 测试结果汇总 ==========\n');
  console.log(`总计: ${results.passed + results.failed + results.skipped} 个测试`);
  console.log(`通过: ${results.passed} ✅`);
  console.log(`失败: ${results.failed} ❌`);
  console.log(`跳过: ${results.skipped} ⏭️`);

  if (results.failed > 0) {
    console.log('\n失败的测试:');
    results.tests
      .filter(t => t.status === 'FAIL')
      .forEach(t => console.log(`  - ${t.name}: ${t.details}`));
    process.exit(1);
  } else {
    console.log('\n🎉 所有 API 测试通过！');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('测试执行错误:', error);
  process.exit(1);
});
