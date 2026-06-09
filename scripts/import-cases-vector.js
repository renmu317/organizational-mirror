/**
 * 批量导入案例到向量数据库
 *
 * 从本地 caseLibrary.json 导入案例到 Supabase，
 * 并生成 embedding 用于向量检索
 *
 * 使用：
 *   OPENAI_API_KEY=xxx node scripts/import-cases-vector.js
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { importCaseWithEmbedding } = require('../lib/vector-search');

const CASE_LIBRARY_PATH = path.join(__dirname, '..', 'data', 'caseLibrary.json');

async function main() {
  console.log('📦 导入案例到向量数据库\n');

  if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error('❌ 请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 环境变量');
    console.log('   用于生成 embedding 向量');
    process.exit(1);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ 请配置 Supabase 环境变量');
    process.exit(1);
  }

  // 读取案例库
  let cases = [];
  try {
    cases = JSON.parse(fs.readFileSync(CASE_LIBRARY_PATH, 'utf-8'));
  } catch (e) {
    console.log('⚠ 案例库为空或不存在');
    process.exit(0);
  }

  console.log(`找到 ${cases.length} 个案例\n`);

  // 逐个导入
  let success = 0;
  let failed = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    console.log(`[${i + 1}/${cases.length}] 导入 ${c.id || c.surface_problem?.slice(0, 20)}...`);

    // 确保有 ID
    if (!c.id) {
      c.id = `CASE_${Date.now()}_${i}`;
    }

    const result = await importCaseWithEmbedding(c);
    if (result) {
      success++;
    } else {
      failed++;
    }

    // 避免 API 速率限制
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '='.repeat(40));
  console.log(`✅ 成功: ${success}`);
  console.log(`❌ 失败: ${failed}`);
}

main().catch(console.error);
