/**
 * 向量检索模块
 *
 * 使用 Supabase pgvector 进行相似度搜索
 */

const { getConversationEmbedding, getCaseEmbedding } = require('./embeddings');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

/**
 * 向量搜索相似案例
 */
async function searchSimilarCases(history, options = {}) {
  const { threshold = 0.6, limit = 5 } = options;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[VectorSearch] Supabase 未配置，跳过向量检索');
    return [];
  }

  // 生成对话的 embedding
  const embedding = await getConversationEmbedding(history);
  if (!embedding) {
    console.log('[VectorSearch] 无法生成 embedding，跳过向量检索');
    return [];
  }

  try {
    // 调用 Supabase 的 match_cases 函数
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_cases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limit
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[VectorSearch] 搜索失败:', error);
      return [];
    }

    const matches = await response.json();
    console.log(`[VectorSearch] 找到 ${matches.length} 个相似案例`);

    return matches;
  } catch (error) {
    console.error('[VectorSearch] 错误:', error.message);
    return [];
  }
}

/**
 * 将案例导入到 Supabase（带 embedding）
 */
async function importCaseWithEmbedding(caseData) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('[VectorSearch] Supabase 未配置');
    return false;
  }

  // 生成 embedding
  const embedding = await getCaseEmbedding(caseData);

  const payload = {
    id: caseData.id,
    source: caseData.source || 'import',
    industry: caseData.industry,
    surface_problem: caseData.surface_problem,
    initial_explanation: caseData.initial_explanation,
    causal_chain: caseData.causal_chain,
    hidden_assumptions: caseData.hidden_assumptions,
    real_bottleneck: caseData.real_bottleneck,
    missing_variables: caseData.missing_variables,
    seven_day_experiment: caseData.seven_day_experiment,
    path: caseData.path,
    completeness: caseData.completeness || 'gap',
    insight_confidence: caseData.insight_confidence || 'medium',
    embedding: embedding
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/cases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[VectorSearch] 导入失败:', error);
      return false;
    }

    console.log(`[VectorSearch] 案例 ${caseData.id} 已导入`);
    return true;
  } catch (error) {
    console.error('[VectorSearch] 导入错误:', error.message);
    return false;
  }
}

/**
 * 构建向量检索的案例提示
 */
function buildVectorCaseHints(matches) {
  if (!matches || matches.length === 0) {
    return [];
  }

  return matches.map((match, index) => {
    const hints = [];

    if (match.surface_problem) {
      hints.push(`类似问题: ${match.surface_problem}`);
    }

    if (match.real_bottleneck) {
      hints.push(`实际瓶颈: ${match.real_bottleneck}`);
    }

    if (match.missing_variables && match.missing_variables.length > 0) {
      hints.push(`缺失变量: ${match.missing_variables.join(', ')}`);
    }

    return {
      index: index + 1,
      similarity: (match.similarity * 100).toFixed(1) + '%',
      hints: hints.join('\n')
    };
  });
}

module.exports = {
  searchSimilarCases,
  importCaseWithEmbedding,
  buildVectorCaseHints
};
