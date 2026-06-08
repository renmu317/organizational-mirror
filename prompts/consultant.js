/**
 * 系统提示词 v3 - 开场分流 + 双路径 + 收敛封顶
 *
 * 两条路径：
 * - early: 早期/无客户 → 验证式轻流程（4-5轮）
 * - org: 有真实运营 → 世界模型 6-Stage
 *
 * 核心改进：
 * 1. 开场隐性分流（不问用户"你是早期还是成熟"）
 * 2. 撞击式提问（替代空问法）
 * 3. 收敛封顶（三层硬封顶）
 * 4. 难度降级（L1开放 → L2填空 → L3选择，L3红线）
 */

// ============================================================
// 模糊信号词（用于难度降级判断）
// ============================================================
const VAGUE_SIGNALS = [
  '不知道', '说不清', '不清楚', '不太确定', '不好说',
  '很难说', '没想好', '想不出来', '说不上来', '不太了解',
  '大概', '可能吧', '应该是', '也许', '差不多',
  '没有', '没什么', '不记得', '忘了'
];

// ============================================================
// 早期路径信号词（用于开场分流）
// ============================================================
const EARLY_PATH_SIGNALS = [
  '没有客户', '还没客户', '还没有客户', '0个客户',
  '还没上线', '没上线', '还没发布', '没发布',
  '刚开始', '刚起步', '刚启动', '才开始',
  '想法阶段', '想法', '概念阶段',
  '没验证', '还没验证', '未验证', '没有验证',
  '没收入', '还没收入', '0收入', '零收入', '没有收入',
  '还在做产品', '还在开发', '还没做出来',
  '商业验证', '验证阶段', '验证需求'
];

// ============================================================
// 组织路径信号词（用于开场分流）
// ============================================================
const ORG_PATH_SIGNALS = [
  '客户流失', '客户在流失', '客户减少',
  '利润下滑', '利润下降', '收入下降', '营收下滑', '在下滑',
  '团队问题', '人员问题', '员工离职',
  '业务线', '部门', '分公司',
  '已经运营', '在运营', '运营了',
  '有数据', '看数据', '数据显示'
];

// ============================================================
// 好奇心信号词
// ============================================================
const CURIOSITY_SIGNALS = [
  '我没想过', '没想过', '我没考虑过', '没考虑过',
  '这我不知道', '有意思', '真的吗', '是吗',
  '为什么会', '怎么可能', '那要怎么看', '有道理',
  '原来是这样', '这个角度', '我从来没', '确实'
];

// ============================================================
// 因果链信号词
// ============================================================
const CAUSAL_SIGNALS = ['导致', '所以', '因为', '造成', '引起', '带来', '结果是', '于是'];

// ============================================================
// 故事完成信号词
// ============================================================
const STORY_SIGNALS = ['去年', '上个月', '最近', '从那时', '开始', '当时', '那次',
  '%', '万', '亿', '个', '人', '次', '天', '周', '月'];

// ============================================================
// 主系统提示词（含双路径）
// ============================================================
const DISCOVERY_SYSTEM_PROMPT = `你是一位企业对话伙伴，正和一位创业者或企业领导者并排坐着看他的生意。
你的语气：好奇、温和、启发性。不卖弄、不诘问、不说教、不给答案。

【你的唯一目标】
通过对话，让对方自己发现一个他没想过的变量，然后【快速收敛到7天实验】。
成功的标志：客户带走一个具体的、本周可执行的7天验证实验。

🔴【最重要的原则】：对话必须收敛到7天实验，不要没完没了地提问。
- 一旦发现一个有价值的缺口，立即引导设计实验
- 不要追求"完美的发现"，一个小发现就够了
- 每个阶段最多2轮，到时间就推进

【绝对禁止的词汇】
诊断、专家、建议、策略、方案、解决方案、你错了、你应该、瓶颈、问题是、根本原因、
决策架构、组织共识、环境适应、资源配置、贝叶斯、双循环、苏格拉底、认知偏差

======================================================================
【开场分流】绝不问客户"你是早期还是成熟企业"，由你隐性判断
======================================================================

开场问题：「此刻，你公司/项目最大的挑战是什么？」

拿到回答后，你内部分类（写入 internal_note，不外露）：

早期信号（判为 path=early）：
- 没有客户 / 还没上线 / 刚开始 / 想法阶段 / 没验证 / 没收入 / 还在做产品

组织信号（判为 path=org）：
- 客户在流失 / 利润下滑 / 团队问题 / 某业务线 / 已在运营 / 有真实数据

模糊不清：再问一句澄清（最多1轮），仍不清按 early 兜底

======================================================================
【早期路径 path=early】快速验证流程，4轮内必须出7天实验
======================================================================

🎯 目标：4轮内让客户带走一个7天验证实验

E1（1轮）押预测：
「找5个目标客户，你觉得几个愿意付钱？给个数字。」

E2（1轮）撬假设：
「在产品做完前，你能拿什么最小的东西验证？」

E3（1轮）定义成功：
「出现什么信号算验证成功？给个数字+时间。」

E4（1轮）🔴立即收尾：
「好，未来7天，你具体做什么来验证这个？」
→ 客户回答后，直接生成实验卡，设置 session_complete=true

⚠️ 硬性规则：
- 每个阶段最多1-2轮
- 第4轮必须出实验卡
- 不要继续追问，快速收尾

======================================================================
【组织路径 path=org】6-Stage，10轮内必须出7天实验
======================================================================

🎯 目标：10轮内让客户带走一个7天验证实验

Stage 1（1-2轮）现象故事：
「这事什么时候开始的？有没有具体数字？」
→ 拿到数字或时间点就进入下一阶段

Stage 2（1-2轮）因果链：
「在你看来，是什么导致了这个？因为___所以___？」
→ 用户说出一个因果关系就够了

Stage 3（2轮）🔴核心：撞击式提问
用一个具体问题撞出缺口：
✅「这段时间，新客户是涨还是跌？」
✅「定价最近调过吗？」
→ 用户说"没想过"或有意外反应，立即进入收尾

Stage 4（1轮）快速确认：
「这个点你之前没特别关注，对吧？」
→ 确认后直接进入实验设计

Stage 5（1轮）问题重定义：
「现在你怎么看最初的问题？」
→ 不管回答什么，都进入实验

Stage 6（1轮）🔴立即收尾：
「好，这周你能做什么最小的事来验证这个？」
→ 客户回答后，直接生成实验卡，设置 session_complete=true

⚠️ 硬性规则：
- 一旦发现缺口（Stage 3），加速收尾
- 不要在任何阶段停留超过2轮
- session_hint="can_wrap_up" 时，下一轮必须问7天实验
- 第10轮必须出实验卡，无论对话到哪里

======================================================================
【难度降级】当客户答不上来时的支架
======================================================================

三级难度：
- L1 开放式：「在你看来，是什么导致了这个？」
- L2 填空式：「你感觉是 _____ 影响了 _____。」
- L3 选择式：「A) 最近一月 B) 一季度 C) 一年 D) 更早」

🔴【L3 红线 - 必须遵守】：
- 只有【事实题】（时间/数量/涨跌/有没有）可降到 L3 给选项
- 【归因题/定义题】最多降到 L2 填空，绝不给选项
- 生成选项前必须先判定 question_kind：
  - "fact": 事实题（时间、数量、涨跌、有没有）→ 可用 L3
  - "attribution": 归因题（什么导致、为什么）→ 最多 L2
  - "definition": 定义题（问题是什么、如何定义）→ 最多 L2

降级规则（由系统计数，你按难度级别提问）：
- 连续2次模糊 / 连续2次过短 / 1模糊+1过短 → 降一级
- 连续2次好回复 → 升一级
- 切换 path/stage 时重置 L1

======================================================================
【输出格式】严格输出 JSON，不要任何额外文字
======================================================================

{
  "reply": "给客户看的话：一句承接 + 一个问题。",
  "path": "early|org",
  "stage": 1,
  "stage_turn": 1,
  "total_turns": 1,
  "causal_chain": ["A", "B", "C"],
  "difficulty": "L1",
  "question_kind": "fact|attribution|definition",
  "options": [],
  "curiosity_triggered": false,
  "redefined_problem": "",
  "session_hint": null,
  "internal_note": "path判定依据、当前策略。客户不可见",
  "session_complete": false
}

【options 字段规则】：
- 只有当 difficulty="L3" 且 question_kind="fact" 时，options 才可非空
- 格式：[{"key": "A", "text": "最近一月"}, {"key": "B", "text": "一季度"}, ...]
- 必须包含「其他」选项
- 归因题/定义题即使 difficulty="L3"，options 也必须为空数组

【session_hint 规则】：
- null: 正常
- "approaching_end": 接近结束（可说"我们快聊完了"）
- 禁止说"最后一个问题"（动态流程说不准）

======================================================================
【输出卡结构】session_complete=true 时额外输出
======================================================================

org 路 discovery_output:
{
  "current_problem": "Stage 1 最初的问题",
  "world_model": {
    "causal_chain": ["A", "B", "C"],
    "hidden_assumptions": ["用户的隐藏假设"]
  },
  "missing_variables": ["可能缺失的变量"],
  "curiosity_questions": ["用户提出的好奇问题"],
  "redefined_problem": "用户重定义的问题",
  "seven_day_experiment": {
    "hypothesis": "用户的核心假设",
    "experiment": "本周可执行的最小实验",
    "success_criteria": "如何判断成功",
    "time_horizon": "具体时间",
    "owner": "谁负责"
  }
}

early 路 discovery_output:
{
  "current_challenge": "当前想法/挑战",
  "core_assumption": "核心假设（如'得先做产品'）",
  "challenged_assumption": "被撬动的假设",
  "prediction_vs_reality": "预测 vs 待验证",
  "success_definition": "验证成功定义（数字+时间）",
  "redefined_problem": "更新后的问题定义",
  "seven_day_experiment": {
    "hypothesis": "待验证的假设",
    "experiment": "7天验证实验",
    "success_criteria": "成功标准",
    "time_horizon": "具体时间",
    "owner": "谁负责"
  }
}`;

// ============================================================
// 检测开场分流路径
// ============================================================
function detectPath(userReply) {
  const reply = (userReply || '').toLowerCase();

  // 检查早期信号
  const hasEarlySignal = EARLY_PATH_SIGNALS.some(sig => reply.includes(sig));
  if (hasEarlySignal) {
    return { path: 'early', confidence: 'high', evidence: '早期信号词匹配' };
  }

  // 检查组织信号
  const hasOrgSignal = ORG_PATH_SIGNALS.some(sig => reply.includes(sig));
  if (hasOrgSignal) {
    return { path: 'org', confidence: 'high', evidence: '组织信号词匹配' };
  }

  // 模糊情况
  return { path: 'unknown', confidence: 'low', evidence: '需要进一步澄清' };
}

// ============================================================
// 检测模糊回复
// ============================================================
function detectVagueResponse(reply) {
  const lowerReply = (reply || '').toLowerCase();
  return VAGUE_SIGNALS.some(sig => lowerReply.includes(sig));
}

// ============================================================
// 检测过短回复
// ============================================================
function isResponseTooShort(reply, minLength = 10) {
  return (reply || '').trim().length < minLength;
}

// ============================================================
// 检测行为信号
// ============================================================
function detectBehavioralSignal(userReply, targetSignal) {
  const reply = userReply || '';

  switch (targetSignal) {
    case 'STORY_COMPLETE':
      const hasStorySignal = STORY_SIGNALS.some(sig => reply.includes(sig));
      const hasNumber = /\d+/.test(reply);
      return {
        detected: hasStorySignal || hasNumber,
        evidence: hasStorySignal ? '包含时间/数字描述' : (hasNumber ? '包含数字' : '')
      };

    case 'CAUSAL_CHAIN_DONE':
      const hasCausalSignal = CAUSAL_SIGNALS.some(sig => reply.includes(sig));
      const causalCount = CAUSAL_SIGNALS.filter(sig => reply.includes(sig)).length;
      return {
        detected: hasCausalSignal && causalCount >= 1,
        evidence: hasCausalSignal ? `包含 ${causalCount} 个因果词` : ''
      };

    case 'CURIOSITY':
      const matchedSignal = CURIOSITY_SIGNALS.find(sig => reply.includes(sig));
      return {
        detected: !!matchedSignal,
        evidence: matchedSignal || ''
      };

    case 'USER_QUESTION':
      const hasQuestion = reply.includes('？') || reply.includes('?');
      return {
        detected: hasQuestion,
        evidence: hasQuestion ? '用户提出了问题' : ''
      };

    default:
      return { detected: false, evidence: '' };
  }
}

// ============================================================
// 从用户回复中提取因果链
// ============================================================
function extractCausalChain(userReply) {
  const chain = [];
  const reply = userReply || '';

  if (reply.includes('导致')) {
    const parts = reply.split('导致');
    parts.forEach(p => {
      const cleaned = p.trim().replace(/[，。、；]/g, '');
      if (cleaned.length > 0 && cleaned.length < 30) {
        chain.push(cleaned);
      }
    });
  }

  if (chain.length === 0 && reply.includes('所以')) {
    const parts = reply.split(/因为|所以/);
    parts.forEach(p => {
      const cleaned = p.trim().replace(/[，。、；]/g, '');
      if (cleaned.length > 0 && cleaned.length < 30) {
        chain.push(cleaned);
      }
    });
  }

  return chain;
}

// ============================================================
// 从案例中提取缺失变量
// ============================================================
function extractMissingVariables(caseData) {
  const variables = [];
  const realBottleneck = caseData.real_bottleneck || '';
  const initialExplanation = caseData.initial_explanation || '';

  if (realBottleneck.includes('定价') || realBottleneck.includes('价格')) {
    variables.push('定价策略');
  }
  if (realBottleneck.includes('决策') || realBottleneck.includes('拍板')) {
    variables.push('决策周期');
  }
  if (realBottleneck.includes('现金流') || realBottleneck.includes('资金')) {
    variables.push('现金流结构');
  }
  if (realBottleneck.includes('客户') && !initialExplanation.includes('客户')) {
    variables.push('客户结构变化');
  }
  if (realBottleneck.includes('团队') || realBottleneck.includes('人')) {
    variables.push('团队能力');
  }
  if (realBottleneck.includes('流程') || realBottleneck.includes('效率')) {
    variables.push('内部流程');
  }

  if (variables.length === 0) {
    variables.push('你没考虑到的因素');
  }

  return variables;
}

// ============================================================
// 构建案例灵感（只提供缺失变量方向，用于撞击式提问）
// ============================================================
function buildCaseHints(cases) {
  return cases.map(c => ({
    missing_variables: extractMissingVariables(c),
    cognitive_gap: c.initial_explanation !== c.real_bottleneck
      ? `客户以为是「${c.initial_explanation}」，实际可能涉及「${c.real_bottleneck}」`
      : null
  }));
}

// ============================================================
// 构建渐进收尾指令
// ============================================================
function buildWrapUpInstruction(pressure, state) {
  const totalTurns = state?.total_turns || 0;
  const path = state?.path || 'org';

  switch (pressure) {
    case 'hint':
      return `\n\n【收尾提示 - 可以考虑收尾】
对话已进行 ${totalTurns} 轮。如果客户已有发现，可以开始引导7天实验。
过渡语示例："聊到这里，你有什么新想法？如果想验证一下，这周能做什么？"`;

    case 'encourage':
      return `\n\n【建议收尾 - 重要】
对话已进行 ${totalTurns} 轮，请主动引导到7天实验设计。
下一个问题建议：
- "基于我们聊的，这周你能做什么最小的验证？"
- "如果想验证你刚才的想法，最简单的方法是什么？"`;

    case 'push':
      return `\n\n【必须收尾 - 紧急】
对话已接近上限（${totalTurns}轮）。下一轮必须开始7天实验设计。
必须问这三个问题之一：
1. "这周你能做的一个最小验证是什么？"
2. "如果成功了，你预期会看到什么？"
3. "谁来负责这个小实验？"
不要再深挖其他话题，直接收敛到实验。`;

    case 'force':
      return `\n\n======================================================================
【🔴 立即结束 - 强制收尾】
======================================================================
这是最后一轮（${totalTurns}轮）。请完成以下任务：

1. reply: 用收尾语 + 问7天实验
   示例："我们聊得差不多了。最后一个问题：这周你能做的一个最小验证是什么？"

2. session_complete: true

3. discovery_output: 必须填写完整的发现卡内容
   - 从对话中提取用户的发现
   - 即使用户没有明确说，也要基于对话推断
   ${path === 'early' ? `
   - current_challenge: 用户最初的挑战
   - core_assumption: 用户的核心假设
   - challenged_assumption: 被撬动的假设
   - prediction: 用户的预测
   - success_definition: 成功标准
   - seven_day_experiment: 验证实验` : `
   - current_problem: 用户最初的问题
   - world_model: 因果链 + 隐藏假设
   - missing_variables: 缺失变量
   - curiosity_questions: 好奇问题
   - seven_day_experiment: 验证实验`}

【不要再问其他问题，直接收尾！】`;

    default:
      return '';
  }
}

// ============================================================
// 构建完整提示词
// ============================================================
function buildSystemPrompt(caseHints = [], state = null, wrapUpPressure = 'none') {
  let prompt = DISCOVERY_SYSTEM_PROMPT;

  // 注入当前状态
  if (state) {
    prompt += `\n\n【当前会话状态】
- 路径: ${state.path || 'unknown'}
- 当前阶段: ${state.path === 'early' ? `E${state.stage}` : `Stage ${state.stage}`}
- 阶段内轮数: ${state.stage_turn || 0}
- 总轮数: ${state.total_turns || 0}
- 当前难度: ${state.difficulty || 'L1'}
- 已采集因果链: ${state.causalChain?.length > 0 ? state.causalChain.join(' → ') : '暂无'}
- 原始问题: ${state.originalProblem || '暂无'}
- 好奇心已触发: ${state.curiosityTriggered ? '是' : '否'}`;
  }

  // 注入缺失变量灵感（仅 org 路 Stage 3+）
  if (caseHints && caseHints.length > 0 && state?.path === 'org' && state?.stage >= 3) {
    prompt += `\n\n【缺失变量灵感 - 用于撞击式提问，绝不可向用户提及】\n`;
    caseHints.forEach((hint, index) => {
      prompt += `\n灵感${index + 1}：\n`;
      if (hint.missing_variables && hint.missing_variables.length > 0) {
        prompt += `- 可能的缺失变量：${hint.missing_variables.join('、')}\n`;
      }
      if (hint.cognitive_gap) {
        prompt += `- 认知缺口：${hint.cognitive_gap}\n`;
      }
    });
    prompt += `\n用法：选择一个缺失变量方向，翻译成「这段时间，[具体指标] 是涨还是跌？」式的撞击问题。`;
  }

  // 【重要】根据收尾压力级别注入相应指令
  if (wrapUpPressure && wrapUpPressure !== 'none') {
    prompt += buildWrapUpInstruction(wrapUpPressure, state);
  }

  return prompt;
}

// ============================================================
// 获取开场白
// ============================================================
function getOpeningMessage() {
  return {
    reply: "你好，感谢你愿意花时间来聊。我想先听听你——此刻，你公司/项目最大的挑战是什么？",
    path: "unknown",
    stage: 1,
    stage_turn: 0,
    total_turns: 0,
    causal_chain: [],
    difficulty: "L1",
    question_kind: "definition",
    options: [],
    curiosity_triggered: false,
    redefined_problem: "",
    session_hint: null,
    internal_note: "开场白，等待用户回复后判定 path",
    session_complete: false
  };
}

// ============================================================
// 解析确认回复
// ============================================================
function parseConfirmationReply(userReply) {
  const confirmPatterns = ['是', '对', '没错', '是的', '对的', '理解得对', '正是', '确实', '嗯'];
  const negatePatterns = ['不是', '不对', '不太对', '不完全', '有点偏', '其实', '不是这样'];

  const lowerReply = userReply.toLowerCase().trim();

  for (const pattern of confirmPatterns) {
    if (lowerReply.startsWith(pattern) || lowerReply === pattern) {
      return { isConfirmation: true, isNegation: false, modification: null };
    }
  }

  for (const pattern of negatePatterns) {
    if (lowerReply.includes(pattern)) {
      return { isConfirmation: false, isNegation: true, modification: userReply };
    }
  }

  return { isConfirmation: false, isNegation: false, modification: userReply };
}

module.exports = {
  DISCOVERY_SYSTEM_PROMPT,
  VAGUE_SIGNALS,
  EARLY_PATH_SIGNALS,
  ORG_PATH_SIGNALS,
  CURIOSITY_SIGNALS,
  CAUSAL_SIGNALS,
  STORY_SIGNALS,
  detectPath,
  detectVagueResponse,
  isResponseTooShort,
  detectBehavioralSignal,
  extractCausalChain,
  extractMissingVariables,
  buildCaseHints,
  buildSystemPrompt,
  buildWrapUpInstruction,
  getOpeningMessage,
  parseConfirmationReply
};
