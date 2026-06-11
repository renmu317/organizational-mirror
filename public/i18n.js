/**
 * 双语字典 (i18n)
 *
 * 两层分离：
 * - uiLang: 界面文案语言（随时可切）
 * - conversationLang: AI 对话语言（开场定，整场固定）
 */

const I18N = {
  zh: {
    // 应用标题
    app_title: "照见",
    app_subtitle: "发现你还没看见的问题",

    // 语言选择
    lang_toggle: "EN",
    lang_select_title: "选择语言",
    lang_select_hint: "对话语言选定后，整场固定",
    lang_zh: "中文",
    lang_en: "English",

    // 开场弹窗
    welcome_title: "欢迎",
    welcome_hint: "输入姓名开始对话",
    name_placeholder: "你的姓名",
    company_placeholder: "公司（选填）",
    btn_start: "开始对话",
    loading: "加载中...",

    // 输入区
    input_placeholder: "此刻，你公司/项目最大的挑战是什么？",
    input_hint: "按 Enter 发送，Shift+Enter 换行",
    btn_send: "发送",
    btn_end: "结束并生成卡片",
    other_placeholder: "请描述...",
    btn_submit: "提交",

    // 侧边栏
    sidebar_new: "+ 新对话",
    sidebar_empty: "暂无历史对话",

    // 回看模式
    replay_hint: "你正在查看历史对话",
    btn_new_chat: "开始新对话",

    // 加载状态
    thinking: "思考中...",

    // 发现卡标题
    card_title_discovery: "你的发现",
    card_title_plan: "你的验证计划",
    card_title_decision: "你的决策",
    card_title_letter: "照见信",

    // 发现卡字段 - 通用
    btn_download: "下载报告",
    btn_restart: "开始新对话",

    // 发现卡字段 - org 路径
    field_current_problem: "当前问题定义",
    field_causal_chain: "当前世界模型（因果链）",
    field_hidden_assumptions: "隐藏假设",
    field_missing_variables: "可能缺失的变量",
    field_curiosity_questions: "好奇问题",
    field_redefined_problem: "更新后的问题定义",
    field_experiment_title: "你的7天实验",
    field_hypothesis: "假设",
    field_experiment: "实验",
    field_success_criteria: "成功标准",
    field_time: "时间",
    field_owner: "负责人",

    // 发现卡字段 - early 路径
    field_current_idea: "当前想法/挑战",
    field_core_assumption: "核心假设",
    field_challenged_assumption: "被撬动的假设",
    field_prediction: "你的预测",
    field_success_definition: "验证成功定义",
    field_validation_title: "你的7天验证实验",
    field_min_validation: "最小验证",

    // 发现卡字段 - strategy 路径【v15 世界规则版】
    field_decision: "你要做的决策",
    field_target_outcome: "你想要的结果",
    field_decision_chain: "决策链条",
    field_weakest_link: "最关键的承重环",
    field_hidden_assumption: "你默认、但没验证的假设",
    field_assumption_source: "这个假设的来源",
    field_world_rule: "你认领的世界规则",
    field_next_step: "接下来先验证的一步",
    field_prediction_title: "你的预测（可验证）",
    field_prediction_object: "预测指标",
    field_if_unchanged: "如果不改",
    field_if_changed: "如果改变",
    field_stake: "价值/代价",
    field_verify_window: "验证时间",

    // 机会钩
    field_next_gap: "下一道缝（如果你想）",

    // 占位符
    not_covered: "本次未涉及",
    placeholder_fill: "待你填",
    default_time: "7天",
    default_owner: "你",

    // 进度提示
    hint_approaching_end: "快要结束了...",
    hint_last_question: "最后一个问题",

    // 错误提示
    error_system: "抱歉，系统遇到了问题。请刷新页面重试。",
    error_network: "网络连接出现问题，请检查后重试。",
    error_create_user: "创建用户失败：",
    error_no_report: "没有可下载的报告",

    // 图片上传
    error_image_type: "请选择 JPG、PNG 或 WebP 格式的图片。",
    error_image_size: "图片大小不能超过 5MB。",
  },

  en: {
    // App title
    app_title: "Hindsight",
    app_subtitle: "See what you haven't seen yet",

    // Language selection
    lang_toggle: "中",
    lang_select_title: "Choose Language",
    lang_select_hint: "Conversation language is fixed once chosen",
    lang_zh: "中文",
    lang_en: "English",

    // Welcome modal
    welcome_title: "Welcome",
    welcome_hint: "Enter your name to start",
    name_placeholder: "Your name",
    company_placeholder: "Company (optional)",
    btn_start: "Start Conversation",
    loading: "Loading...",

    // Input area
    input_placeholder: "What's the biggest challenge you're facing right now?",
    input_hint: "Enter to send, Shift+Enter for new line",
    btn_send: "Send",
    btn_end: "End & Generate Card",
    other_placeholder: "Please describe...",
    btn_submit: "Submit",

    // Sidebar
    sidebar_new: "+ New Chat",
    sidebar_empty: "No conversations yet",

    // Replay mode
    replay_hint: "You are viewing a past conversation",
    btn_new_chat: "Start New Conversation",

    // Loading state
    thinking: "Thinking...",

    // Discovery card titles
    card_title_discovery: "Your Discovery",
    card_title_plan: "Your Validation Plan",
    card_title_decision: "Your Decision",
    card_title_letter: "Letter of Insight",

    // Discovery card fields - common
    btn_download: "Download Report",
    btn_restart: "New Conversation",

    // Discovery card fields - org path
    field_current_problem: "Current Problem Definition",
    field_causal_chain: "Current World Model (Causal Chain)",
    field_hidden_assumptions: "Hidden Assumptions",
    field_missing_variables: "Possibly Missing Variables",
    field_curiosity_questions: "Questions That Made You Curious",
    field_redefined_problem: "Redefined Problem",
    field_experiment_title: "Your 7-Day Experiment",
    field_hypothesis: "Hypothesis",
    field_experiment: "Experiment",
    field_success_criteria: "Success Criteria",
    field_time: "Timeline",
    field_owner: "Owner",

    // Discovery card fields - early path
    field_current_idea: "Current Idea/Challenge",
    field_core_assumption: "Core Assumption",
    field_challenged_assumption: "Challenged Assumption",
    field_prediction: "Your Prediction",
    field_success_definition: "Success Definition",
    field_validation_title: "Your 7-Day Validation",
    field_min_validation: "Minimum Validation",

    // Discovery card fields - strategy path【v15 World Rule】
    field_decision: "The Decision You're Making",
    field_target_outcome: "Your Desired Outcome",
    field_decision_chain: "Decision Chain",
    field_weakest_link: "The Most Critical Link",
    field_hidden_assumption: "Assumption You Haven't Verified",
    field_assumption_source: "Where This Assumption Came From",
    field_world_rule: "The Rule You've Been Running On",
    field_next_step: "Next Step to Verify",
    field_prediction_title: "Your Prediction (Verifiable)",
    field_prediction_object: "Metric",
    field_if_unchanged: "If unchanged",
    field_if_changed: "If changed",
    field_stake: "Stakes",
    field_verify_window: "Verification Window",

    // Opportunity hook
    field_next_gap: "Next Gap (if you want)",

    // Placeholders
    not_covered: "Not covered this time",
    placeholder_fill: "To be filled",
    default_time: "7 days",
    default_owner: "You",

    // Progress hints
    hint_approaching_end: "Almost done...",
    hint_last_question: "Last question",

    // Error messages
    error_system: "Sorry, something went wrong. Please refresh and try again.",
    error_network: "Network error. Please check your connection.",
    error_create_user: "Failed to create user: ",
    error_no_report: "No report to download",

    // Image upload
    error_image_type: "Please select a JPG, PNG, or WebP image.",
    error_image_size: "Image must be smaller than 5MB.",
  }
};

// 当前界面语言（默认中文）
let currentUILang = 'zh';

// 当前对话语言（开场选定后不可变）
let currentConversationLang = null;

/**
 * 获取翻译文本
 */
function t(key) {
  return I18N[currentUILang]?.[key] || I18N['zh'][key] || key;
}

/**
 * 设置界面语言
 */
function setUILang(lang) {
  if (lang === 'zh' || lang === 'en') {
    currentUILang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    return true;
  }
  return false;
}

/**
 * 获取当前界面语言
 */
function getUILang() {
  return currentUILang;
}

/**
 * 设置对话语言（只能设置一次）
 */
function setConversationLang(lang) {
  if (currentConversationLang === null && (lang === 'zh' || lang === 'en')) {
    currentConversationLang = lang;
    return true;
  }
  return false;
}

/**
 * 获取当前对话语言
 */
function getConversationLang() {
  return currentConversationLang;
}

/**
 * 重置对话语言（新对话时调用）
 */
function resetConversationLang() {
  currentConversationLang = null;
}

/**
 * 检测浏览器语言
 */
function detectBrowserLang() {
  const browserLang = navigator.language || navigator.userLanguage;
  return browserLang?.startsWith('zh') ? 'zh' : 'en';
}

// 导出（供模块化使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { I18N, t, setUILang, getUILang, setConversationLang, getConversationLang, resetConversationLang, detectBrowserLang };
}
