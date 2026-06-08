/**
 * 构建时注入环境变量到 config.js
 * 用于 Vercel 部署
 */

const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '..', 'public', 'config.js');

// 读取环境变量
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('⚠️  警告: SUPABASE_URL 或 SUPABASE_ANON_KEY 未设置');
  console.warn('   前端将无法连接到 Supabase Edge Functions');
}

// 读取模板
let content = fs.readFileSync(configPath, 'utf-8');

// 替换占位符
content = content.replace('__SUPABASE_URL__', SUPABASE_URL);
content = content.replace('__SUPABASE_ANON_KEY__', SUPABASE_ANON_KEY);

// 写回文件
fs.writeFileSync(configPath, content);

console.log('✅ config.js 已注入环境变量');
console.log(`   SUPABASE_URL: ${SUPABASE_URL ? SUPABASE_URL.substring(0, 30) + '...' : '(未设置)'}`);
console.log(`   SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY ? '***' + SUPABASE_ANON_KEY.slice(-8) : '(未设置)'}`);
