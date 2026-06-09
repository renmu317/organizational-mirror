/**
 * 向量嵌入模块
 *
 * 支持：
 * - DeepSeek embedding (优先)
 * - OpenAI text-embedding-3-small (备选)
 * - 本地缓存避免重复调用
 */

const fs = require('fs');
const path = require('path');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CACHE_PATH = path.join(__dirname, '..', 'data', 'embedding-cache.json');

// 加载缓存
let embeddingCache = {};
try {
  if (fs.existsSync(CACHE_PATH)) {
    embeddingCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  }
} catch (e) {
  embeddingCache = {};
}

// 保存缓存
function saveCache() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(embeddingCache), 'utf-8');
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
 * 使用 DeepSeek 或 OpenAI API 生成 embedding
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

  // 优先使用 DeepSeek
  if (DEEPSEEK_API_KEY) {
    const embedding = await getDeepSeekEmbedding(text);
    if (embedding) {
      embeddingCache[cacheKey] = embedding;
      saveCache();
      return embedding;
    }
  }

  // 备选 OpenAI
  if (OPENAI_API_KEY) {
    const embedding = await getOpenAIEmbedding(text);
    if (embedding) {
      embeddingCache[cacheKey] = embedding;
      saveCache();
      return embedding;
    }
  }

  console.warn('[Embedding] 无可用的 API Key');
  return null;
}

/**
 * DeepSeek Embedding API
 */
async function getDeepSeekEmbedding(text) {
  try {
    const response = await fetch('https://api.deepseek.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-embedding',
        input: text.slice(0, 8000)
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Embedding] DeepSeek 错误:', error);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('[Embedding] DeepSeek 失败:', error.message);
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
