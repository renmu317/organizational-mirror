# 认知对抗收敛模块 - 实现计划

## 设计决策（已确认）

| 决策项 | 选择 |
|--------|------|
| 集成方式 | **独立新模块** - 新建 /api/diagnose 端点 |
| AI调用 | **每次调 DeepSeek API** - 动态生成问题 |
| 案例库 | **使用现有 caseLibrary.json** - 辅助生成假设 |

---

## 新增文件结构

```
organizational-mirror/
├── src/
│   └── convergence/
│       ├── types.ts              # 数据结构定义
│       ├── session.ts            # DiagnosticSession 管理
│       ├── questionChain.ts      # QuestionChain 逻辑
│       ├── convergence.ts        # 收敛边界检查
│       ├── hypothesis.ts         # 假设生成
│       ├── validation.ts         # 7天验证计划
│       ├── report.ts             # 诊断报告生成
│       └── prompts.ts            # 收敛模块专用提示词
├── server.js                     # 新增 /api/diagnose/* 端点
└── public/
    └── diagnose.html             # 收敛诊断专用UI（可选）
```

---

## 核心数据结构 (types.ts)

```typescript
// 停止原因枚举
type StopReason =
  | "CORE_HYPOTHESIS_FOUND"    // 发现核心假设
  | "VALIDATION_PLAN_READY"    // 验证计划就绪
  | "INSUFFICIENT_EVIDENCE"    // 证据不足
  | null;                      // 未停止

// 问题链深度
type QuestionDepth = 1 | 2 | 3;

// 单个问题链
interface QuestionChain {
  chainId: string;              // 唯一ID
  targetSymptom: string;        // 针对的症状
  questions: {
    depth: QuestionDepth;
    question: string;
    userAnswer: string;
    timestamp: string;
  }[];
  convergenceScore: number;     // 0-1 收敛度
  extractedAssumptions: string[]; // 提取的隐含假设
}

// 可验证假设
interface Hypothesis {
  statement: string;            // 假设陈述
  observableEvidence: string[]; // 可观测证据
  verificationMethod: string;   // 验证方法
  verificationPeriodDays: number; // 验证周期
}

// 7天验证计划
interface ValidationPlan {
  day1_3: string;               // 第1-3天任务
  day4_6: string;               // 第4-6天任务
  day7: string;                 // 第7天复盘
  dailyCheckItems: string[];    // 每日检查项
  successCriteria: string;      // 成功标准
}

// 诊断会话
interface DiagnosticSession {
  sessionId: string;
  createdAt: string;

  // Rule 1: 问题聚焦
  primarySymptom: string;         // 主要症状
  secondarySymptoms: string[];    // 次要症状
  selectedProblemFocus: string;   // 选定的聚焦问题

  // Rule 2: 问题链（最多3层）
  questionChains: QuestionChain[];
  currentChainId: string | null;

  // Rule 3: 认知错误候选
  cognitiveErrorCandidates: string[];

  // Rule 4: 停止条件
  stopReason: StopReason;

  // 输出
  coreHypothesis: Hypothesis | null;
  sevenDayValidationPlan: ValidationPlan | null;
  diagnosticReport: string | null;

  // 元数据
  matchedCases: string[];        // 匹配的案例ID
  totalQuestions: number;
  convergenceProgress: number;   // 0-100%
}

// 最终输出格式
interface DiagnosticOutput {
  primarySymptom: string;
  selectedProblemFocus: string;
  originalProblemDefinition: string;
  questionChains: QuestionChain[];
  cognitiveErrorCandidates: string[];
  coreHypothesis: Hypothesis;
  stopReason: StopReason;
  sevenDayValidationPlan: ValidationPlan;
  diagnosticReport: string;
}
```

---

## 核心函数设计

### 1. checkConvergenceBoundary (convergence.ts)

```typescript
/**
 * 检查是否达到收敛边界
 * @returns { shouldStop, reason, readyForHypothesis }
 */
function checkConvergenceBoundary(session: DiagnosticSession): {
  shouldStop: boolean;
  reason: StopReason;
  readyForHypothesis: boolean;
} {
  // 条件A: 当前问题链已达3层
  const currentChain = session.questionChains.find(
    c => c.chainId === session.currentChainId
  );
  if (currentChain && currentChain.questions.length >= 3) {
    return { shouldStop: true, reason: "CORE_HYPOTHESIS_FOUND", readyForHypothesis: true };
  }

  // 条件B: 已有足够信息生成验证计划
  if (session.convergenceProgress >= 80) {
    return { shouldStop: true, reason: "VALIDATION_PLAN_READY", readyForHypothesis: true };
  }

  // 条件C: 用户无法提供更多证据（由AI判断）
  // 通过 userAnswer 中的关键词检测："不知道"、"不清楚"、"没有数据"

  return { shouldStop: false, reason: null, readyForHypothesis: false };
}
```

### 2. generateNextQuestion (questionChain.ts)

```typescript
/**
 * 生成下一个问题（调用 DeepSeek API）
 *
 * 规则：
 * - depth=1: 为什么你认为是这个问题？
 * - depth=2: 你有什么具体证据支持这个判断？
 * - depth=3: 如果X提升/解决，问题就一定消失吗？
 */
async function generateNextQuestion(
  session: DiagnosticSession,
  matchedCases: Case[]
): Promise<{ question: string; depth: QuestionDepth }> {
  const currentChain = getCurrentChain(session);
  const nextDepth = (currentChain.questions.length + 1) as QuestionDepth;

  // 调用 DeepSeek API
  const prompt = buildQuestionPrompt(session, matchedCases, nextDepth);
  const response = await callDeepSeek(prompt);

  return {
    question: response.question,
    depth: nextDepth
  };
}
```

### 3. generateHypothesis (hypothesis.ts)

```typescript
/**
 * 基于问题链和案例库生成可验证假设
 */
async function generateHypothesis(
  session: DiagnosticSession,
  matchedCases: Case[]
): Promise<Hypothesis> {
  // 从问题链中提取：
  // - 用户的原始归因
  // - 被撬动的假设
  // - 浮现的真实问题方向

  // 参考案例库中的 real_bottleneck 和 effective_action

  return {
    statement: "利润下降的核心原因可能不是销售能力不足，而是...",
    observableEvidence: [...],
    verificationMethod: "连续7天记录...",
    verificationPeriodDays: 7
  };
}
```

### 4. generate7DayValidationPlan (validation.ts)

```typescript
/**
 * 生成7天最小验证计划
 */
function generate7DayValidationPlan(
  hypothesis: Hypothesis,
  session: DiagnosticSession
): ValidationPlan {
  return {
    day1_3: "收集基线数据：" + hypothesis.observableEvidence.join("、"),
    day4_6: "实施小规模干预：" + hypothesis.verificationMethod,
    day7: "复盘对比：数据变化 vs 预期",
    dailyCheckItems: [...],
    successCriteria: "..."
  };
}
```

### 5. generateDiagnosticReport (report.ts)

```typescript
/**
 * 生成诊断报告（调用 DeepSeek API）
 */
async function generateDiagnosticReport(
  session: DiagnosticSession
): Promise<string> {
  // 结构化报告：
  // 1. 原始问题定义
  // 2. 认知对抗过程摘要
  // 3. 发现的认知偏差
  // 4. 核心假设
  // 5. 7天验证计划
  // 6. 预期结果
}
```

---

## API 端点设计

### POST /api/diagnose/start

```typescript
// 请求
{ symptoms: string[] }  // 用户输入的多个症状

// 响应
{
  sessionId: string,
  primarySymptom: string,      // AI识别的主症状
  secondarySymptoms: string[],
  needsFocusSelection: boolean, // 是否需要用户选择聚焦
  suggestedFocus: string        // AI建议的聚焦点
}
```

### POST /api/diagnose/select-focus

```typescript
// 请求
{ sessionId: string, selectedFocus: string }

// 响应
{ success: boolean, firstQuestion: string }
```

### POST /api/diagnose/answer

```typescript
// 请求
{
  sessionId: string,
  answer: string
}

// 响应
{
  nextQuestion: string | null,
  currentDepth: 1 | 2 | 3,
  convergenceProgress: number,  // 0-100%
  shouldStop: boolean,
  stopReason: StopReason
}
```

### POST /api/diagnose/generate-output

```typescript
// 请求
{ sessionId: string }

// 响应: DiagnosticOutput
```

---

## 收敛模块专用提示词 (prompts.ts)

```typescript
const CONVERGENCE_SYSTEM_PROMPT = `
你是一位企业诊断专家，正在帮助企业负责人从"表面问题"收敛到"可验证的核心假设"。

【核心任务】
通过最多3层追问，帮助用户发现他没看见的真实问题。

【三层追问模板】
第一层：为什么你认为是这个问题？（挖掘归因）
第二层：你有什么具体证据？数字？事件？（验证事实）
第三层：如果X改善，问题就一定解决吗？（撬动假设）

【禁止的问题类型】
- 人格化攻击：你是不是控制欲太强？
- 心理分析：你是不是不相信员工？
- 无法验证：你的战略能力是否不足？

【允许的问题类型】
- 可观测：决策是否集中在一个人？
- 可量化：一个项目从提出到批准平均多久？
- 可追溯：过去30天有多少任务因等待审批被延迟？

【输出格式】
{
  "question": "你的下一个问题",
  "depth": 1|2|3,
  "targetAssumption": "这个问题要撬动的假设",
  "convergenceHint": "收敛方向提示（内部用）"
}
`;
```

---

## 与现有案例库集成

```typescript
// 在 generateNextQuestion 和 generateHypothesis 中使用
function matchCasesForConvergence(session: DiagnosticSession): Case[] {
  const cases = loadCaseLibrary();

  // 匹配维度：
  // 1. surface_problem 关键词相似
  // 2. initial_explanation 归因模式相似
  // 3. real_bottleneck 枚举匹配

  return cases
    .filter(c => c.completeness !== 'skeleton')
    .map(c => ({ ...c, score: calculateMatchScore(c, session) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// 利用案例的 key_questions 辅助生成追问
// 利用案例的 real_bottleneck 辅助生成假设方向
```

---

## 实现步骤

### Step 1: 创建 TypeScript 配置
- 安装 typescript, ts-node
- 创建 tsconfig.json
- 创建 src/convergence/ 目录

### Step 2: 实现数据结构 (types.ts)
- 定义所有接口和类型

### Step 3: 实现核心函数
- session.ts: 会话管理
- questionChain.ts: 问题链逻辑 + generateNextQuestion
- convergence.ts: checkConvergenceBoundary
- hypothesis.ts: generateHypothesis
- validation.ts: generate7DayValidationPlan
- report.ts: generateDiagnosticReport
- prompts.ts: 专用提示词

### Step 4: 添加 API 端点
- 在 server.js 中新增 /api/diagnose/* 路由

### Step 5: 测试验证
- 完整诊断流程测试
- 验证3层限制生效
- 验证停止条件触发

---

## 验证方式

```bash
# 1. 启动诊断
curl -X POST http://localhost:3000/api/diagnose/start \
  -H "Content-Type: application/json" \
  -d '{"symptoms":["利润下降","员工流失","销售下降"]}'

# 2. 选择聚焦
curl -X POST http://localhost:3000/api/diagnose/select-focus \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"xxx","selectedFocus":"利润下降"}'

# 3. 回答问题（重复3次）
curl -X POST http://localhost:3000/api/diagnose/answer \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"xxx","answer":"我认为是销售不够努力"}'

# 4. 获取输出
curl -X POST http://localhost:3000/api/diagnose/generate-output \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"xxx"}'
```

**成功标准：**
- 问题链最多3层后自动停止
- 生成可验证假设（含 observableEvidence）
- 生成7天验证计划
- 不出现人格化/攻击性问题

---

## 实现状态

**已完成** (2026-06-08)

| 文件 | 状态 |
|------|------|
| `src/convergence/types.ts` | ✅ |
| `src/convergence/session.ts` | ✅ |
| `src/convergence/convergence.ts` | ✅ |
| `src/convergence/questionChain.ts` | ✅ |
| `src/convergence/hypothesis.ts` | ✅ |
| `src/convergence/validation.ts` | ✅ |
| `src/convergence/report.ts` | ✅ |
| `src/convergence/prompts.ts` | ✅ |
| `src/convergence/index.ts` | ✅ |
| `server.js` API 端点 | ✅ |
| `tsconfig.json` | ✅ |
| `package.json` 构建脚本 | ✅ |

**测试验证通过：**
- `/api/diagnose/start` ✅
- `/api/diagnose/select-focus` ✅
- `/api/diagnose/answer` ✅
- `/api/diagnose/generate-output` ✅
