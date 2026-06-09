/**
 * 提示词优化脚本
 *
 * 从会话数据中学习，生成优化建议
 *
 * 使用：
 *   node scripts/optimize-prompts.js
 */

require('dotenv').config({ path: '.env.local' });

const { learnFromSessions, getLearnedPatterns } = require('../lib/prompt-optimizer');

async function main() {
  console.log('🧠 照见 - 提示词优化\n');
  console.log('='.repeat(50));

  // 学习
  const patterns = await learnFromSessions();

  if (!patterns) {
    console.log('\n❌ 学习失败');
    process.exit(1);
  }

  // 显示结果
  console.log('\n📊 学习结果\n');

  console.log('【有效问题示例】');
  Object.entries(patterns.effectiveQuestions).forEach(([stage, qs]) => {
    if (qs.length > 0) {
      console.log(`\n${stage}:`);
      qs.slice(0, 2).forEach((q, i) => {
        console.log(`  ${i + 1}. ${q.slice(0, 80)}...`);
      });
    }
  });

  console.log('\n【好奇心触发器】');
  if (patterns.curiosityTriggers.length > 0) {
    patterns.curiosityTriggers.slice(0, 3).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.slice(0, 80)}...`);
    });
  } else {
    console.log('  暂无数据');
  }

  console.log('\n【高频缺失变量】');
  if (patterns.frequentMissingVars.length > 0) {
    console.log(`  ${patterns.frequentMissingVars.slice(0, 5).join('、')}`);
  } else {
    console.log('  暂无数据');
  }

  console.log('\n【高频隐藏假设】');
  if (patterns.frequentAssumptions.length > 0) {
    console.log(`  ${patterns.frequentAssumptions.slice(0, 5).join('、')}`);
  } else {
    console.log('  暂无数据');
  }

  console.log('\n【需要避免的问法】');
  if (patterns.failurePatterns.length > 0) {
    patterns.failurePatterns.slice(0, 3).forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.slice(0, 80)}...`);
    });
  } else {
    console.log('  暂无数据');
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ 模式已保存，更新时间: ${patterns.lastUpdated}`);
  console.log('\n下次对话将自动使用这些学习结果');
}

main().catch(console.error);
