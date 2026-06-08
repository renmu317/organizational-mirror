import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Signal words for path detection
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

const ORG_PATH_SIGNALS = [
  '客户流失', '客户在流失', '客户减少',
  '利润下滑', '利润下降', '收入下降', '营收下滑', '在下滑',
  '团队问题', '人员问题', '员工离职',
  '业务线', '部门', '分公司',
  '已经运营', '在运营', '运营了',
  '有数据', '看数据', '数据显示'
];

const VAGUE_SIGNALS = [
  '不知道', '说不清', '不清楚', '不太确定', '不好说',
  '很难说', '没想好', '想不出来', '说不上来', '不太了解',
  '大概', '可能吧', '应该是', '也许', '差不多',
  '没有', '没什么', '不记得', '忘了'
];

const CURIOSITY_SIGNALS = [
  '我没想过', '没想过', '我没考虑过', '没考虑过',
  '这我不知道', '有意思', '真的吗', '是吗',
  '为什么会', '怎么可能', '那要怎么看', '有道理',
  '原来是这样', '这个角度', '我从来没', '确实'
];

function detectPath(userReply: string) {
  const reply = (userReply || '').toLowerCase();
  const hasEarlySignal = EARLY_PATH_SIGNALS.some(sig => reply.includes(sig));
  if (hasEarlySignal) return { path: 'early', confidence: 'high' };
  const hasOrgSignal = ORG_PATH_SIGNALS.some(sig => reply.includes(sig));
  if (hasOrgSignal) return { path: 'org', confidence: 'high' };
  return { path: 'unknown', confidence: 'low' };
}

function detectVagueResponse(reply: string) {
  return VAGUE_SIGNALS.some(sig => (reply || '').includes(sig));
}

function detectCuriositySignal(reply: string) {
  return CURIOSITY_SIGNALS.some(sig => (reply || '').includes(sig));
}

function buildDefaultDiscoveryOutput(state: any) {
  if (state.path === 'early') {
    return {
      current_idea: state.originalProblem || '待填写',
      core_assumption: '待验证',
      challenged_assumption: '待验证',
      prediction: '待填写',
      success_definition: '待定义',
      redefined_problem: state.redefinedProblem || state.originalProblem || '待重定义',
      seven_day_experiment: {
        experiment: '待设计',
        success_criteria: '待定义',
        time_horizon: '7天',
        owner: '你'
      }
    };
  }
  return {
    current_problem: state.originalProblem || '待填写',
    world_model: {
      causal_chain: state.causalChain || [],
      hidden_assumptions: []
    },
    missing_variables: [],
    curiosity_questions: [],
    redefined_problem: state.redefinedProblem || state.originalProblem || '待重定义',
    seven_day_experiment: {
      hypothesis: '待填写',
      experiment: '待设计',
      success_criteria: '待定义',
      time_horizon: '7天',
      owner: '你'
    }
  };
}

const CAPS = {
  early: { maxTotalTurns: 10, softLimit: 5, stageMaxTurns: { 1: 3, 2: 3, 3: 3, 4: 3 } },
  org: { maxTotalTurns: 30, softLimit: 12, stageMaxTurns: { 1: 4, 2: 5, 3: 5, 4: 4, 5: 4, 6: 4 } }
};

function buildSystemPrompt(path: string, stage: number, difficulty: string) {
  return `你是一位企业对话伙伴，正和一位创业者或企业领导者并排坐着看他的生意。
你的语气：好奇、温和、启发性。不卖弄、不诘问、不说教、不给答案。

【你的唯一目标】
通过对话，让对方自己发现他世界模型中的隐藏假设和缺失变量。

【绝对禁止的词汇】
诊断、专家、建议、策略、方案、解决方案、你错了、你应该、瓶颈、问题是、根本原因

【当前路径】${path}
【当前阶段】${stage}
【当前难度】${difficulty}

${path === 'early' ? `
【早期路径】帮早期创业者走到7天需求验证实验
- E1 押预测：找5个目标客户，你觉得几个愿意付钱？
- E2 撬先造后验：产品做完前，能拿什么最小的东西验证？
- E3 定义验证成功：什么信号算验证成功？
- E4 最小实验：未来7天能做的最小验证是什么？
` : `
【组织路径】6阶段世界模型发现
- Stage 1: 现象故事（采集症状+时间线）
- Stage 2: 世界模型外显化（让用户画出因果链）
- Stage 3: 隐藏变量发现（插入缺失变量，用撞击式提问：涨/跌/数字）
- Stage 4: 好奇心触发（把缺口转为问题）
- Stage 5: 问题重定义（用户重述问题）
- Stage 6: 7天实验（生成验证计划）
`}

${difficulty === 'L2' ? '使用填空式提问：你认为 _____ 导致了 _____。' : ''}
${difficulty === 'L3' ? '使用选择题（仅限事实题）：A) 选项一 B) 选项二 C) 选项三 D) 其他' : ''}

【输出格式】JSON
{
  "reply": "给客户的话",
  "stage": ${stage},
  "question_kind": "fact|attribution|definition",
  "options": [],
  "session_complete": false,
  "discovery_output": null
}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { history, sessionId } = await req.json();
    const sid = sessionId || `S${Date.now()}`;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get or create session state
    let sessionState = {
      path: 'unknown',
      stage: 1,
      stage_turn: 0,
      total_turns: 0,
      difficulty: 'L1',
      vague_streak: 0,
      causalChain: [],
      originalProblem: '',
      curiosityTriggered: false,
      redefinedProblem: ''
    };

    // Check for existing session
    const { data: existingSession } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sid)
      .single();

    if (existingSession) {
      sessionState = {
        path: existingSession.path,
        stage: existingSession.stage,
        stage_turn: existingSession.stage_turn,
        total_turns: existingSession.total_turns,
        difficulty: existingSession.difficulty,
        vague_streak: existingSession.vague_streak,
        causalChain: existingSession.causal_chain || [],
        originalProblem: existingSession.original_problem || '',
        curiosityTriggered: existingSession.curiosity_triggered,
        redefinedProblem: existingSession.redefined_problem || ''
      };
    }

    // New conversation - return opening
    if (!history || history.length === 0) {
      const openingReply = "你好，感谢你愿意花时间来聊。此刻，你公司/项目最大的挑战是什么？";

      // Save initial session
      await supabase.from('sessions').upsert({
        id: sid,
        path: 'unknown',
        stage: 1,
        stage_turn: 0,
        total_turns: 0,
        difficulty: 'L1',
        vague_streak: 0,
        causal_chain: [],
        history: [{ role: 'assistant', content: openingReply }],
        session_complete: false
      });

      return new Response(JSON.stringify({
        reply: openingReply,
        path: 'unknown',
        stage: 1,
        stage_turn: 0,
        total_turns: 0,
        difficulty: 'L1',
        causal_chain: [],
        curiosity_triggered: false,
        session_complete: false,
        sessionId: sid
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Process user message
    const lastUserMsg = history[history.length - 1]?.content || '';

    // 计算用户消息数量（更可靠的轮数计算，防止页面刷新导致计数丢失）
    const userMessageCount = history.filter((m: any) => m.role === 'user').length;
    sessionState.total_turns = Math.max(sessionState.total_turns + 1, userMessageCount);
    sessionState.stage_turn++;

    // Path detection (first user message)
    if (sessionState.path === 'unknown' && history.length >= 2) {
      const pathResult = detectPath(lastUserMsg);
      if (pathResult.path !== 'unknown') {
        sessionState.path = pathResult.path;
      }
    }

    // Detect signals
    const isVague = detectVagueResponse(lastUserMsg);
    const curiosityTriggered = detectCuriositySignal(lastUserMsg);

    if (curiosityTriggered) {
      sessionState.curiosityTriggered = true;
    }

    // Difficulty adjustment
    if (isVague) {
      sessionState.vague_streak++;
      if (sessionState.vague_streak >= 2 && sessionState.difficulty !== 'L3') {
        sessionState.difficulty = sessionState.difficulty === 'L1' ? 'L2' : 'L3';
        sessionState.vague_streak = 0;
      }
    } else {
      sessionState.vague_streak = 0;
    }

    // Check caps (soft limit for hints, hard limit as safety net)
    const caps = CAPS[sessionState.path as keyof typeof CAPS] || CAPS.org;
    const sessionHint = sessionState.total_turns >= caps.softLimit ? 'can_wrap_up' : null;
    const shouldEndFromCaps = sessionState.total_turns >= caps.maxTotalTurns;

    // Call DeepSeek API
    const deepseekApiKey = Deno.env.get("DEEPSEEK_API_KEY");
    const systemPrompt = buildSystemPrompt(sessionState.path, sessionState.stage, sessionState.difficulty);

    const aiResponse = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${deepseekApiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          ...history
        ],
        temperature: 0.7
      })
    });

    const aiData = await aiResponse.json();
    let reply = aiData.choices?.[0]?.message?.content || "抱歉，请稍后再试。";

    // Try to parse JSON response
    let parsedReply: any = { reply };
    try {
      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedReply = JSON.parse(jsonMatch[0]);
      }
    } catch {
      parsedReply = { reply };
    }

    // Update session in database
    await supabase.from('sessions').upsert({
      id: sid,
      path: sessionState.path,
      stage: parsedReply.stage || sessionState.stage,
      stage_turn: sessionState.stage_turn,
      total_turns: sessionState.total_turns,
      difficulty: sessionState.difficulty,
      vague_streak: sessionState.vague_streak,
      causal_chain: parsedReply.causal_chain || sessionState.causalChain,
      original_problem: sessionState.originalProblem,
      curiosity_triggered: sessionState.curiosityTriggered,
      redefined_problem: parsedReply.redefined_problem || sessionState.redefinedProblem,
      history: history,
      session_complete: shouldEndFromCaps || parsedReply.session_complete,
      discovery_output: parsedReply.discovery_output
    });

    // L3 redline enforcement
    if (parsedReply.question_kind !== 'fact') {
      parsedReply.options = [];
    }

    const finalSessionComplete = shouldEndFromCaps || parsedReply.session_complete || false;

    return new Response(JSON.stringify({
      reply: parsedReply.reply || reply,
      path: sessionState.path,
      stage: parsedReply.stage || sessionState.stage,
      stage_turn: sessionState.stage_turn,
      total_turns: sessionState.total_turns,
      difficulty: sessionState.difficulty,
      question_kind: parsedReply.question_kind || 'definition',
      options: parsedReply.options || [],
      causal_chain: parsedReply.causal_chain || sessionState.causalChain,
      curiosity_triggered: sessionState.curiosityTriggered,
      session_hint: sessionHint,
      session_complete: finalSessionComplete,
      discovery_output: finalSessionComplete ? (parsedReply.discovery_output || buildDefaultDiscoveryOutput(sessionState)) : null,
      sessionId: sid
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
