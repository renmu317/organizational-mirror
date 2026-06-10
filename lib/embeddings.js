/**
 * 向量嵌入模块
 *
 * 支持（按优先级）：
 * 1. OpenAI text-embedding-3-small (OPENAI_API_KEY)
 * 2. Jina AI jina-embeddings-v3 (JINA_API_KEY)
 * 3. 本地缓存避免重复调用
 *
 * 注意：DeepSeek 不支持 embedding API
 */

const fs = require('fs');
const path = require('path');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const JINA_API_KEY = process.env.JINA_API_KEY;
const CACHE_PATH = path.join(__dirname, '..', 'data', 'embedding-cache.json');

// 启动时检查 embedding 配置
if (!OPENAI_API_KEY && !JINA_API_KEY) {
  console.log('[Embedding] ⚠️ 未配置 embedding API，案例将不带向量。配置方法：');
  console.log('  - OpenAI: 设置 OPENAI_API_KEY');
  console.log('  - Jina AI (免费): 设置 JINA_API_KEY (从 https://jina.ai 获取)');
}

// 加载缓存
let embeddingCache = {};
try {
  if (fs.existsSync(CACHE_PATH)) {
    embeddingCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  }
} catch (e) {
  embeddingCache = {};
}

// 保存缓存（serverless 环境跳过）
function saveCache() {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(embeddingCache), 'utf-8');
  } catch (e) {
    // Serverless 环境只读文件系统，跳过缓存写入
  }
}

// 生成文本的哈希作为缓存键
function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * 生成 embedding（优先 OpenAI，备选 Jina）
 */
async function getEmbedding(text) {
  if (!text || text.trim().length === 0) {
    return null;
  }

  // 检查缓存
  const cacheKey = hashText(text);
  if (embeddingCache[cacheKey]) {
    return embeddingCache[cacheKey];
  }

  // 优先使用 OpenAI（1536 维）
  if (OPENAI_API_KEY) {
    const embedding = await getOpenAIEmbedding(text);
    if (embedding) {
      embeddingCache[cacheKey] = embedding;
      saveCache();
      return embedding;
    }
  }

  // 备选 Jina AI（1024 维，免费 tier 可用）
  if (JINA_API_KEY) {
    const embedding = await getJinaEmbedding(text);
    if (embedding) {
      embeddingCache[cacheKey] = embedding;
      saveCache();
      return embedding;
    }
  }

  // 无可用 API，静默返回 null（案例仍可存入，只是无向量）
  return null;
}

/**
 * Jina AI Embedding API（免费 tier 支持）
 * 文档：https://jina.ai/embeddings
 */
async function getJinaEmbedding(text) {
  try {
    const response = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JINA_API_KEY}`
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        task: 'text-matching',
        dimensions: 1024,
        input: [text.slice(0, 8000)]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Embedding] Jina 错误:', error);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('[Embedding] Jina 失败:', error.message);
    return null;
  }
}

/**
 * OpenAI Embedding API (备选)
 */
async function getOpenAIEmbedding(text) {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000)
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Embedding] OpenAI 错误:', error);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('[Embedding] OpenAI 失败:', error.message);
    return null;
  }
}

/**
 * 为案例生成 embedding
 * 将关键字段拼接成文本
 */
async function getCaseEmbedding(caseData) {
  const textParts = [
    caseData.surface_problem,
    caseData.initial_explanation,
    caseData.real_bottleneck,
    caseData.industry,
    ...(caseData.causal_chain || []),
    ...(caseData.missing_variables || [])
  ].filter(Boolean);

  const text = textParts.join(' ');
  return getEmbedding(text);
}

/**
 * 为用户对话生成 embedding
 */
async function getConversationEmbedding(history) {
  const userMessages = history
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' ');

  return getEmbedding(userMessages);
}

module.exports = {
  getEmbedding,
  getCaseEmbedding,
  getConversationEmbedding
};
