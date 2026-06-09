/**
 * 历史数据深度指标补充脚本
 * 为没有 depth_metrics 的历史会话补充深度数据
 */

const fs = require('fs');
const path = require('path');

// 导入认知层检测函数
const { detectCognitionLayer } = require('../prompts/consultant');

// 深度映射
const LAYER_DEPTH_MAP = {
  'result': 1,
  'behavior': 2,
  'decision': 3,
  'assumption': 4,
  'environment': 5,
  'rule': 6
};

// 计算深度指标
function calculateDepthMetrics(layerSequence) {
  if (!layerSequence || layerSequence.length === 0) {
    return null;
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

// 从历史对话中提取认知层级序列
function extractLayerSequence(history) {
  const sequence = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      const detection = detectCognitionLayer(msg.content);
      sequence.push(detection.layer);
    }
  }

  return sequence;
}

// 判断会话路径
function detectSessionPath(session) {
  // 如果已有 path，直接使用
  if (session.path && session.path !== 'unknown') {
    return session.path;
  }

  // 从 surface_problem 推断
  const problem = (session.surface_problem || '').toLowerCase();

  // 早期路径信号
  const earlySignals = ['没有客户', '还没客户', '没客户', '想法阶段', '没验证', '没收入'];
  if (earlySignals.some(s => problem.includes(s))) {
    return 'early';
  }

  // 组织路径信号
  const orgSignals = ['下滑', '流失', '债务', '亏损', '利润'];
  if (orgSignals.some(s => problem.includes(s))) {
    return 'org';
  }

  return 'unknown';
}

// 主函数
function backfillDepthMetrics() {
  const sessionsPath = path.join(__dirname, '..', 'data', 'sessions.json');

  if (!fs.existsSync(sessionsPath)) {
    console.log('sessions.json 不存在');
    return;
  }

  const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
  let updated = 0;
  let skipped = 0;

  console.log('='.repeat(50));
  console.log('历史数据深度指标补充');
  console.log('='.repeat(50));
  console.log(`总会话数: ${sessions.length}\n`);

  for (const session of sessions) {
    // 判断路径
    const detectedPath = detectSessionPath(session);
    if (!session.path || session.path === 'unknown') {
      session.path = detectedPath;
    }

    // 只处理 org 路径且没有 depth_metrics 的会话
    if (session.path !== 'org') {
      console.log(`[${session.id}] 跳过 - 路径: ${session.path}`);
      skipped++;
      continue;
    }

    if (session.depth_metrics && session.depth_metrics.max_depth > 0) {
      console.log(`[${session.id}] 跳过 - 已有深度数据`);
      skipped++;
      continue;
    }

    // 提取认知层级序列
    const layerSequence = extractLayerSequence(session.history || []);

    if (layerSequence.length === 0) {
      console.log(`[${session.id}] 跳过 - 无用户消息`);
      skipped++;
      continue;
    }

    // 计算深度指标
    const depthMetrics = calculateDepthMetrics(layerSequence);
    session.depth_metrics = depthMetrics;

    console.log(`[${session.id}] 更新成功`);
    console.log(`  层级序列: ${layerSequence.join(' → ')}`);
    console.log(`  最大深度: ${depthMetrics.max_depth}`);
    console.log(`  假设突破: ${depthMetrics.broke_assumption ? '是' : '否'}`);
    console.log('');

    updated++;
  }

  // 保存
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));

  console.log('='.repeat(50));
  console.log(`完成: ${updated} 条更新, ${skipped} 条跳过`);
  console.log('='.repeat(50));
}

// 执行
backfillDepthMetrics();
