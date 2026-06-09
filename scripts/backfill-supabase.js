#!/usr/bin/env node
/**
 * 回填 Supabase 会话的 depth_metrics
 * 分析对话历史，估算每轮的认知层，计算深度指标
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dcllelkyiqpdsforioff.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjbGxlbGt5aXFwZHNmb3Jpb2ZmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTY5MywiZXhwIjoyMDk2NDM3NjkzfQ.3sOV5oyrCwfM8FYf2h7g4ty3uCEjplSx2N4D-yPzMiU';

// 认知层深度映射
const LAYER_DEPTH_MAP = {
  'result': 1,
  'behavior': 2,
  'decision': 3,
  'assumption': 4,
  'environment': 5,
  'rule': 6
};

// 认知层关键词（用于从对话内容估算）
const LAYER_KEYWORDS = {
  rule: [
    '一直相信', '一直以为', '一直觉得', '世界规则', '底层信念',
    '过去成功', '经验外推', '这条规则', '这个信念', '普遍规则',
    '为什么会相信', '元规则', '底层逻辑'
  ],
  environment: [
    '环境变化', '市场变了', '行业变化', '外部因素', '大环境',
    '竞争对手', '政策变化', '技术迭代', '用户需求变化',
    '什么时候开始', '失效信号', '环境层'
  ],
  assumption: [
    '假设', '以为', '觉得', '认为', '误判', '错误判断',
    '当时想', '原来以为', '没想到', '假设来源', '为什么这么想',
    '怎么形成的', '哪里来的'
  ],
  decision: [
    '决定', '选择', '决策', '为什么选', '当时为什么', '没有做',
    '为什么没', '放弃了', '优先', '取舍', '权衡'
  ],
  behavior: [
    '做了', '行动', '执行', '操作', '采取', '实施',
    '具体做', '怎么做', '做什么'
  ],
  result: [
    '结果', '现状', '问题是', '困境', '挑战', '目标',
    '数据', '指标', '业绩', '营收', '利润'
  ]
};

// 从对话内容估算认知层
function estimateCognitionLayer(content) {
  if (!content) return 'result';

  const text = content.toLowerCase();

  // 按深度从深到浅检测
  for (const layer of ['rule', 'environment', 'assumption', 'decision', 'behavior', 'result']) {
    const keywords = LAYER_KEYWORDS[layer];
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        return layer;
      }
    }
  }

  return 'result';
}

// 分析对话历史，提取认知层序列
function analyzeHistory(history) {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return [];
  }

  const layerSequence = [];

  // 遍历用户和助手的对话
  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      const layer = estimateCognitionLayer(msg.content);
      layerSequence.push(layer);
    }
  }

  return layerSequence;
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

// 估算 path
function estimatePath(history) {
  if (!history || history.length === 0) return 'unknown';

  const fullText = history.map(m => m.content || '').join(' ').toLowerCase();

  const earlySignals = ['没有客户', '想法阶段', '没验证', '刚开始', '没上线', '概念阶段'];
  const orgSignals = ['客户流失', '利润下降', '团队问题', '营收', '已运营', '员工', '组织'];

  let earlyScore = 0;
  let orgScore = 0;

  for (const s of earlySignals) {
    if (fullText.includes(s)) earlyScore++;
  }
  for (const s of orgSignals) {
    if (fullText.includes(s)) orgScore++;
  }

  if (earlyScore > orgScore) return 'early';
  if (orgScore > earlyScore) return 'org';
  return 'unknown';
}

// 估算 branch (org only)
function estimateBranch(history, path) {
  if (path !== 'org') return null;

  const fullText = history.map(m => m.content || '').join(' ').toLowerCase();

  const retroSignals = ['已经倒闭', '公司没了', '已经结束', '关掉了', '破产', '当年', '那时候'];

  for (const s of retroSignals) {
    if (fullText.includes(s)) return 'retrospective';
  }

  return 'actionable';
}

// 主函数
async function main() {
  console.log('=== Supabase 深度数据回填 ===\n');

  // 1. 获取所有会话
  console.log('1. 获取会话列表...');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/sessions?select=*`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    }
  });

  if (!response.ok) {
    console.error('获取失败:', await response.text());
    return;
  }

  const sessions = await response.json();
  console.log(`   找到 ${sessions.length} 个会话\n`);

  // 2. 筛选需要回填的会话（有历史但没有 depth_metrics）
  const toBackfill = sessions.filter(s =>
    s.history &&
    s.history.length > 4 &&
    (!s.depth_metrics || !s.depth_metrics.max_depth)
  );

  console.log(`2. 需要回填: ${toBackfill.length} 个会话\n`);

  if (toBackfill.length === 0) {
    console.log('   无需回填，退出');
    return;
  }

  // 3. 逐个回填
  let successCount = 0;
  for (const session of toBackfill) {
    console.log(`\n处理 ${session.id}:`);
    console.log(`   历史长度: ${session.history.length} 轮`);

    // 分析
    const layerSequence = analyzeHistory(session.history);
    const depthMetrics = calculateDepthMetrics(layerSequence);
    const path = session.path === 'unknown' ? estimatePath(session.history) : session.path;
    const branch = estimateBranch(session.history, path);

    console.log(`   估算路径: ${path}`);
    console.log(`   估算分支: ${branch || 'N/A'}`);
    console.log(`   深度指标: max=${depthMetrics.max_depth}, broke=${depthMetrics.broke_assumption}, rule=${depthMetrics.reached_rule}`);
    console.log(`   层序列前10: ${layerSequence.slice(0, 10).join(' → ')}`);

    // 更新 Supabase
    const updateData = {
      depth_metrics: depthMetrics,
      layer_sequence: layerSequence,
      cognition_layer: layerSequence[layerSequence.length - 1] || 'result'
    };

    // 只在原来是 unknown 时更新 path
    if (session.path === 'unknown' && path !== 'unknown') {
      updateData.path = path;
    }

    // 只在 org 路径且没有 branch 时更新
    if (path === 'org' && !session.branch && branch) {
      updateData.branch = branch;
    }

    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/sessions?id=eq.${session.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updateData)
      }
    );

    if (updateResponse.ok) {
      console.log(`   ✅ 更新成功`);
      successCount++;
    } else {
      console.log(`   ❌ 更新失败: ${await updateResponse.text()}`);
    }
  }

  console.log(`\n=== 完成: ${successCount}/${toBackfill.length} 个会话已回填 ===`);
}

main().catch(console.error);
