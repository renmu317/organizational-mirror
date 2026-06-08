/**
 * 导入案例数据到 Supabase
 *
 * 使用方法：
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx node scripts/import-to-supabase.js
 *
 * 或在 .env.local 中配置后：
 *   source .env.local && node scripts/import-to-supabase.js
 */

require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');

// 从环境变量读取（绝不硬编码）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// 检查必需的环境变量
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 错误: 缺少环境变量');
  console.error('   请设置 SUPABASE_URL 和 SUPABASE_SERVICE_KEY');
  console.error('   示例: SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... node scripts/import-to-supabase.js');
  process.exit(1);
}

async function importCases() {
  // Read case library
  const casesPath = path.join(__dirname, '..', 'data', 'caseLibrary.json');
  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'));

  console.log(`Importing ${cases.length} cases to Supabase...`);

  // Import in batches
  const batchSize = 10;
  for (let i = 0; i < cases.length; i += batchSize) {
    const batch = cases.slice(i, i + batchSize);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/cases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(batch)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Error importing batch ${i / batchSize + 1}:`, error);
    } else {
      console.log(`Imported batch ${i / batchSize + 1} (${batch.length} cases)`);
    }
  }

  console.log('Import complete!');
}

importCases().catch(console.error);
