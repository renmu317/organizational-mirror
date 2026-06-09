/**
 * 回填脚本：为历史 session 补充 path 和 depth_metrics
 *
 * 用法：node scripts/backfill-path.js
 *
 * 逻辑：
 * 1. 从 Supabase 读取所有 path 为空或 unknown 的 session
 * 2. 根据 transcript 内容判断 path（early/org）
 * 3. 计算 depth_metrics（仅 org 路径）
 * 4. 更新回 Supabase
 */

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Early 路径信号词
const EARLY_SIGNALS = [
  '没有客户', '还没上线', '刚开始', '想法阶段', '没验证',
  '没收入', '还在做产品', '还没有客户', '产品没有', '想法',
  '验证', '市场', 'demo', 'MVP'
];

// Org 路径信号词
const ORG_SIGNALS = [
  '客户流失', '利润下滑', '团队', '业务线', '已在运营',
  '债务', '收入下降', '成本', '竞争', '裁员', '融资',
  '倒闭', '现金流', '增长', '流失'
];

// 认知深度映射
const LAYER_DEPTH_MAP = {
  'result': 1,
  'behavior': 2,
  'decision': 3,
  'assumption': 4,
  'environment': 5,
  'rule': 6
};

// 根据对话内容判断 path
function detectPath(history) {
  if (!history || history.length === 0) return 'unknown';

  const userMessages = history
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join(' ')
    .toLowerCase();

  let earlyScore = 0;
  let orgScore = 0;

  for (const signal of EARLY_SIGNALS) {
    if (userMessages.includes(signal.toLowerCase())) earlyScore++;
  }

  for (const signal of ORG_SIGNALS) {
    if (userMessages.includes(signal.toLowerCase())) orgScore++;
  }

  if (earlyScore > orgScore) return 'early';
  if (orgScore > earlyScore) return 'org';
  if (userMessages.length < 50) return 'early'; // 短对话默认 early

  return 'org'; // 默认 org
}

// 根据对话内容推断认知层
function inferCognitionLayers(history) {
  const layers = [];

  const userMessages = history.filter(m => m.role === 'user');

  for (const msg of userMessages) {
    const content = typeof msg.content === 'string' ? msg.content.toLowerCase() : '';
    let layer = 'result';

    // 检测关键词推断层级
    if (content.includes('规则') || content.includes('一直相信') || content.includes('默认')) {
      layer = 'rule';
    } else if (content.includes('行业') || content.includes('环境') || content.includes('趋势') || content.includes('市场变化')) {
      layer = 'environment';
    } else if (content.includes('以为') || content.includes('假设') || content.includes('原来') || content.includes('没想到') || content.includes('错了')) {
      layer = 'assumption';
    } else if (content.includes('决定') || content.includes('判断') || content.includes('选择') || content.includes('因为') || content.includes('所以')) {
      layer = 'decision';
    } else if (content.includes('做了') || content.includes('去') || content.includes('尝试') || content.includes('调整')) {
      layer = 'behavior';
    }

    layers.push(layer);
  }

  return layers;
}

// 计算深度指标
function calculateDepthMetrics(layerSequence) {
  if (!layerSequence || layerSequence.length === 0) {
    return {
      layer_sequence: [],
      max_depth: 0,
      broke_assumption: false,
      reached_rule: false,
      turns: 0
    };
  }

  const depths = layerSequence.map(layer => LAYER_DEPTH_MAP[layer] || 1);
  const maxDepth = Math.max(...depths);

  return {
    layer_sequence: layerSequence,
    max_depth: maxDepth,
    broke_assumption: maxDepth >= 4,
    reached_rule: maxDepth === 6,
    turns: layerSequence.length
  };
}

async function backfillSessions() {
  console.log('='.repeat(60));
  console.log('Session Path/Depth 回填脚本');
  console.log('='.repeat(60));

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('错误: 请配置 SUPABASE_URL 和 SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  // 1. 获取需要回填的 session
  console.log('\n1. 获取未分类或缺少深度数据的 session...');

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sessions?select=*&order=created_at.desc`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  );

  if (!response.ok) {
    console.error('获取 session 失败:', await response.text());
    process.exit(1);
  }

  const allSessions = await response.json();
  console.log(`   总共 ${allSessions.length} 条 session`);

  // 筛选需要回填的
  const needsBackfill = allSessions.filter(s =>
    !s.path || s.path === 'unknown' || !s.depth_metrics
  );

  console.log(`   需要回填: ${needsBackfill.length} 条`);

  if (needsBackfill.length === 0) {
    console.log('\n✓ 所有 session 已有 path 和 depth_metrics，无需回填');
    return;
  }

  // 2. 回填每个 session
  console.log('\n2. 开始回填...');

  let successCount = 0;
  let failCount = 0;

  for (const session of needsBackfill) {
    const history = session.history || [];

    // 判断 path
    let path = session.path;
    if (!path || path === 'unknown') {
      path = detectPath(history);
    }

    // 计算 depth_metrics（仅 org 路径）
    let depthMetrics = session.depth_metrics;
    if (path === 'org' && (!depthMetrics || !depthMetrics.max_depth)) {
      const layers = inferCognitionLayers(history);
      depthMetrics = calculateDepthMetrics(layers);
    }

    // 更新到 Supabase
    const updatePayload = {
      path: path,
      depth_metrics: depthMetrics
    };

    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/sessions?id=eq.${session.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    );

    if (updateResponse.ok) {
      console.log(`   ✓ ${session.id}: path=${path}, max_depth=${depthMetrics?.max_depth || 'N/A'}`);
      successCount++;
    } else {
      console.log(`   ✗ ${session.id}: ${await updateResponse.text()}`);
      failCount++;
    }
  }

  // 3. 总结
  console.log('\n' + '='.repeat(60));
  console.log('回填完成');
  console.log(`   成功: ${successCount}`);
  console.log(`   失败: ${failCount}`);
  console.log('='.repeat(60));
}

backfillSessions().catch(console.error);
