/**
 * 检查自动采纳的案例
 */
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL) {
  console.log('SUPABASE_URL 未配置');
  process.exit(1);
}

async function checkCases() {
  const response = await fetch(
    SUPABASE_URL + '/rest/v1/cases?source=eq.auto_learn&order=created_at.desc&limit=5',
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
      }
    }
  );

  if (!response.ok) {
    console.log('查询失败:', await response.text());
    return;
  }

  const cases = await response.json();
  console.log('=== 自动采纳案例 ===');
  console.log('找到', cases.length, '个\n');

  if (cases.length === 0) {
    console.log('（暂无自动采纳案例）');
    return;
  }

  cases.forEach((c, i) => {
    console.log('#' + (i+1));
    console.log('  ID:', c.id);
    console.log('  路径:', c.path);
    console.log('  行业:', c.industry);
    console.log('  质量分:', c.quality_score);
    console.log('  收尾原因:', c.close_reason);
    console.log('  时间:', c.created_at || c.timestamp);
    console.log('  问题:', (c.surface_problem || '').slice(0, 50));
    console.log('  embedding:', c.embedding ? '✓ (' + c.embedding.length + '维)' : '✗');
    console.log('');
  });
}

checkCases().catch(console.error);
