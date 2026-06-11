# 组织镜子 (Organizational Mirror) - Claude 项目指南

## 项目定位

一个让企业领导者**自己发现**组织真实瓶颈的 AI 咨询对话工具。

## v18.3 强化照见信「价值」段落 (2026-06-11 更新)

### v18.3 核心变化

**1. 强化照见信「价值」段落**

强化 `REPORT_GENERATION_PROMPT` 中第6步「价值」的描述：

| 维度 | 旧 | 新 |
|------|---|---|
| **数字提取** | 无 | 从对话中提取用户说过的具体数字（金额、时间、百分比、人数等） |
| **呈现方式** | 单一问句 | 对比式呈现两种可能 |

**2. 下载格式改为 HTML**

| 维度 | 旧 | 新 |
|------|---|---|
| **格式** | Markdown (.md) | HTML (.html) |
| **兼容性** | 需要 MD 阅读器 | 手机/电脑浏览器直接打开 |
| **样式** | 无 | 内联 CSS，响应式设计 |
| **内容** | 结构化字段 | 优先使用 narrative_report 叙事格式 |

### 下载文件名

| 内容类型 | 中文 | 英文 |
|---------|------|------|
| 照见信 | `照见信.html` | `mirror-letter.html` |
| 验证计划 | `验证计划.html` | `validation-plan.html` |
| 决策报告 | `决策报告.html` | `decision-report.html` |
| 发现报告 | `发现报告.html` | `discovery-report.html` |

### 新的「价值」段落格式

```
6. 价值（量化 + 对比）：
   - 先从对话中提取用户说过的具体数字
   - 然后用对比式呈现两种可能：
     · 如果这条规则是对的，你会继续...（维持现状的代价）
     · 如果这条规则是错的，你可能...（机会或止损）
```

### 示例

**中文**：
> "你提到已经等了3个月的账期，损失了20万现金流。如果'行规必须等一个月'这条规则是对的，你会继续等下去，现金流压力不会缓解；如果它是错的，你可能早就可以和客户谈预付款，省下这3个月的等待成本。"

**英文**：
> "You mentioned losing $50k and 3 months waiting. If 'clients need 30-day terms' is right, you'll keep waiting and cash flow stays tight; if it's wrong, you might have negotiated prepayment and saved those 3 months."

### v18.3 修改文件

| 文件 | 改动内容 |
|------|----------|
| `prompts/consultant.js` | `REPORT_GENERATION_PROMPT` 第6步强化 |
| `public/app.js` | `generateReportHTML()` 新方法 + `downloadReport()` 改为 HTML |

### 验证方法

**价值段落验证**：
1. 完成一个包含数字的对话（如"损失了X万"、"等了X个月"）
2. 检查生成的照见信中第6步是否有：
   - 用户说过的具体数字
   - 对比式呈现（如果对的... vs 如果错的...）

**下载格式验证**：
1. 完成对话后点击"下载"按钮
2. 确认下载的是 `.html` 文件
3. 用手机浏览器打开，确认排版正常、可读

---

## v15.0 策略型世界规则 (2026-06-10 更新)

### v15 核心理念

> strategy 路的终点不是"想清楚决策"，而是"看见决策背后那条一直信着的世界规则"。

### v15 核心变化

| 维度 | 旧（v14 压力测试版） | 新（v15 世界规则版） |
|------|-------------------|-------------------|
| **终点** | 压力测试 + 下一步 | 世界规则认领 + 轻下一步 |
| **收尾信号** | 多标志检测 | `has_world_rule && has_next_step` |
| **硬上限** | 16轮 | 24轮（仅防技术失控） |
| **收尾风格** | 可能硬切 | 必须温和、留余味 |
| **输出卡** | 8字段含 prediction | 8字段含 world_rule |

### strategy 路输出卡（v15 格式）

```json
{
  "decision": "用户要做的决策",
  "target_outcome": "用户想要的结果",
  "decision_chain": ["步骤1","步骤2","步骤3"],
  "weakest_link": "最关键的承重环",
  "hidden_assumption": "用户默认但没验证的假设",
  "assumption_source": "这个假设的来源",
  "world_rule": "用户认领的世界规则",
  "next_step": "接下来先验证的一步"
}
```

### 收尾条件

| 条件 | 触发 |
|------|------|
| `strategyReady` | `has_world_rule && has_next_step` |
| `strategyCap` | 24轮硬上限（收尾温和，不硬切） |
| `user_requested` | 用户点击"结束"按钮 |

### v15 修改文件清单

| 文件 | 改动内容 |
|------|----------|
| `prompts/consultant.js` | strategy 路提示词改为"挖世界规则"版 |
| `server.js` | 硬上限 24轮，收尾条件简化，输出格式移除 prediction 改用 world_rule |
| `public/app.js` | `buildStrategyPathCard()` 显示新字段 |
| `public/i18n.js` | 新增 `field_assumption_source` 和 `field_world_rule` |
| `public/styles.css` | 新增 `.card-field.world-rule` 样式 |

---

## v11.0 问题/机会双脸循环 (2026-06-09 更新)

### v11 核心理念

> 闭环于问题，重启于机会。closure 不是终点，是检查点。

### v11 新功能

| 功能 | 说明 |
|------|------|
| **下一道缝机会钩** | 发现卡末尾新增 `next_gap_hook` 字段 |
| **pull 式措辞** | "如果你想..."、"想看的话..." |
| **三条红线** | 机会钩永远 pull、闭环优先、去留无条件 |

### 机会钩生成条件

| 路径 | 触发条件 | 措辞示例 |
|------|----------|----------|
| **org·actionable** | 有 world_rule | "既然你已经看清'...'——你手上还在用这套老逻辑运转的，还有哪一块？" |
| **org·retrospective** | 有 world_rule | "下次创业如果遇到类似处境，你最先想看清的会是什么？"（措辞克制） |
| **early** | 有实验行动 | "等你验证完这一轮，如果发现预测和现实不符，那个'不符'里可能藏着下一道值得挖的缝。" |

### 三条硬约束

```
1. 机会钩永远是 pull、门虚掩（"如果你想..."）
2. 闭环优先于钩子——用户必须能干净离开
3. 去留无条件——位置决定语气，永远不决定去留
```

### v11 修改文件清单

| 文件 | 改动内容 |
|------|----------|
| `server.js` | `buildDefaultDiscoveryOutput()` 新增 `next_gap_hook` 生成逻辑 |
| `prompts/consultant.js` | JSON schema 新增 `next_gap_hook` 字段 + 指令段落 |
| `public/app.js` | `buildEarlyPathCard()` 和 `buildOrgPathCard()` 新增钩子渲染 |
| `public/styles.css` | 新增 `.card-field.next-gap-hook` 样式 |

### discovery_output 新增字段

```javascript
{
  // ...existing fields...
  next_gap_hook: string | null  // 【v11】出口机会钩（仅闭环时填充）
}
```

### AI JSON 输出格式扩展

```json
{
  // ...existing fields...
  "next_gap_hook": ""  // 【v11】闭环后的机会钩（pull式、虚掩门）；未闭环填空串
}
```

### 验收清单

| # | 检查点 | 预期 |
|---|--------|------|
| 1 | org·actionable 闭环 | 卡片末尾出现「下一道缝」 |
| 2 | org·retrospective 闭环 | 卡片末尾出现（措辞克制） |
| 3 | early 路径闭环 | 卡片末尾出现 |
| 4 | 中途结束（无 world_rule） | **不显示**「下一道缝」 |
| 5 | 用户点结束按钮 | 仍能干净离开 |
| 6 | 钩子措辞 | pull 式，非威胁式 |

---

## v9.0 侧边栏 + 后台 + 图片上传 (2026-06-09 更新)

### v9 新功能

| 功能 | 说明 |
|------|------|
| **历史对话侧边栏** | 用户姓名登录 + 会话列表 + 回看功能 |
| **Admin 后台增强** | 密码保护 + 用户浏览 + 会话详情 |
| **图片上传分析** | 上传财报/截图，AI 结合图片提问 |

### 访问地址

| 页面 | URL |
|------|-----|
| 主页 | http://localhost:3000 |
| Admin 后台 | http://localhost:3000/admin.html |

### v9 新增 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/users` | POST | 创建/查找用户 |
| `/api/sessions` | GET | 获取用户会话列表 |
| `/api/sessions/:id` | GET | 获取单条完整会话 |
| `/api/admin/verify` | POST | 验证 Admin 密码 |
| `/api/admin/users` | GET | 获取所有用户列表 |
| `/api/admin/users/:id/sessions` | GET | 获取用户的所有会话 |

### 环境变量

```bash
# .env 新增
ADMIN_PASSWORD=<your-password>
DEEPSEEK_VISION_MODEL=deepseek-chat
```

## v8.0 全路径硬收尾 (2026-06-08 更新)

### v8 核心改进

| 维度 | 旧（v7 软上限） | 新（v8 硬收尾） |
|------|----------------|----------------|
| **收尾逻辑** | 依赖 AI 的 session_complete | 服务端多条件兜底 |
| **early 路径** | 约 6 轮软上限 | 成功定义+实验行动 或 8轮硬上限 |
| **org 路径** | 挖到 world_rule 收尾 | world_rule+1轮 或 18轮硬上限 |
| **用户控制** | 无 | 常驻"结束并生成卡片"按钮 |
| **防循环** | 无 | early 路径铁律防无限质疑 |

### 六种收尾条件（任一触发即收尾）

| 条件 | 说明 |
|------|------|
| `ai_complete` | AI 返回 session_complete=true |
| `retrospective_done` | retrospective 分支 + 已挖到 world_rule |
| `actionable_done` | actionable 分支 + world_rule + 又问了1轮 |
| `early_ready` | early 路径 + 有成功定义 + 有实验行动 |
| `early_cap` | early 路径 ≥8 轮硬上限 |
| `org_cap` | org 路径 ≥18 轮硬上限 |
| `user_requested` | 用户点击"结束并生成卡片" |

## v3.0 双路径架构

### 核心改进

| 维度 | 旧（v2 6-Stage） | 新（v3 双路径） |
|------|-----------------|-----------------|
| **用户分类** | 无 | 开场隐性分流（early/org） |
| **早期项目** | 用同一套流程 | 轻验证式（4-5轮） |
| **提问方式** | 可能空泛 | 撞击式（涨/跌/数字） |
| **UI** | 6阶段进度条 | 单页面无进度条 |
| **收敛** | 无硬上限 | 三层封顶 |
| **难度** | 固定 | L1→L2→L3 渐进降级 |

### 双路径设计

| 路径 | 触发信号 | 轮数 | 目标 |
|------|---------|------|------|
| **early** | 没有客户/没上线/想法阶段/没验证 | ≤5轮 | 7天需求验证实验 |
| **org** | 客户流失/利润下滑/团队问题/已在运营 | ≤15轮 | 7天变量验证实验 |

### 难度降级机制

| Level | 形式 | 示例 |
|-------|------|------|
| L1 | 开放式 | 「在你看来，是什么导致了这个？」 |
| L2 | 填空式 | 「你感觉是 ___ 影响了 ___。」 |
| L3 | 选择式 | 「A) 最近一月 B) 一季度 C) 一年」 |

**L3 红线**: 只有事实题（时间/数量/涨跌）可用 L3，归因/定义题最多 L2

## 核心铁律（最高优先级）

1. **绝不诊断** — AI 永远不说「你的问题是 X」
2. **绝不暴露理论标签** — 禁用词见下方
3. **绝不暴露案例库** — 不说「根据案例库」「类似案例」
4. **答案永远由客户自己得出** — 只创造知识缺口，触发好奇心

### 禁用词列表

```
诊断、专家、建议、策略、方案、解决方案、你错了、你应该、
瓶颈、问题是、根本原因、决策架构、组织共识、环境适应、
资源配置、贝叶斯、双循环、苏格拉底、认知偏差
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 前端 | 原生 HTML/CSS/JS（单页面） |
| AI | DeepSeek API (deepseek-chat) |
| 存储 | JSON 文件 |

## 目录结构

```
organizational-mirror/
├── server.js              # Express 后端（v3 双路径）
├── prompts/consultant.js  # 系统提示词（双路径 + 难度）
├── scripts/import.js      # xlsx → caseLibrary.json
├── data/
│   ├── caseLibrary.json   # 案例库（仅提供缺失变量灵感）
│   └── sessions.json      # 对话记录
├── public/
│   ├── index.html         # 单页面 UI（无进度条）
│   ├── app.js             # 前端逻辑（选择题 + 双输出卡）
│   └── styles.css         # McKinsey 风格
├── tests/
│   └── discovery.test.js  # v3 测试（57个测试）
└── plan.md                # v3 实现计划
```

## 常用命令

```bash
# 启动服务
cd /Users/renmu/企业组织认知系统/organizational-mirror
npm start
# 访问 http://localhost:3000

# 运行测试
node tests/discovery.test.js

# 导入案例
node scripts/import.js "/path/to/采集表.xlsx"

# 停止服务
pkill -f "node server.js"
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/respond` | POST | 核心对话（返回 path/stage/difficulty/options） |
| `/api/session/save` | POST | 保存完成的对话（含 discoveryOutput） |
| `/api/session/followup` | POST | 回访更新 |
| `/api/sessions/pending-followup` | GET | 查询待回访 sessions |
| `/api/stats` | GET | 案例库统计 |
| `/api/health` | GET | 健康检查 |

### API 响应格式（v3）

```json
{
  "reply": "给客户的话",
  "path": "early|org",
  "stage": 1-6,
  "stage_turn": 0,
  "total_turns": 1,
  "difficulty": "L1|L2|L3",
  "question_kind": "fact|attribution|definition",
  "options": [],
  "causal_chain": [],
  "curiosity_triggered": false,
  "session_hint": null,
  "session_complete": false,
  "sessionId": "S..."
}
```

### API 测试验证（v3）

```bash
# 1. 健康检查
curl http://localhost:3000/api/health
# {"status":"ok","version":"3.0-dual-path",...}

# 2. 回归测试：早期路径
curl -X POST http://localhost:3000/api/respond -H "Content-Type: application/json" \
  -d '{"history":[{"role":"assistant","content":"你好"},{"role":"user","content":"商业验证阶段，没有客户"}]}'
# 期望：path: "early"

# 3. 组织路径
curl -X POST http://localhost:3000/api/respond -H "Content-Type: application/json" \
  -d '{"history":[{"role":"assistant","content":"你好"},{"role":"user","content":"客户流失，利润下降30%"}]}'
# 期望：path: "org"
```

## 输出卡（双路径）

### org 路径输出
| 字段 | 内容 |
|------|------|
| 当前问题定义 | Stage 1 的问题 |
| 当前世界模型（因果链） | A → B → C |
| 隐藏假设 | 用户的隐藏假设 |
| 可能缺失的变量 | AI 插入的变量 |
| 好奇问题 | 用户提出的问题 |
| 更新后的问题定义 | Stage 5 重定义 |
| 7天实验 | 验证计划 |

### early 路径输出
| 字段 | 内容 |
|------|------|
| 当前想法/挑战 | 初始描述 |
| 核心假设 | 用户最初的假设 |
| 被撬动的假设 | 受到挑战的假设 |
| 预测 vs 待验证 | 用户的预测 |
| 验证成功定义 | 成功标准 |
| 更新后的问题定义 | 重定义 |
| 7天验证实验 | 最小验证 |

## 成功标准

客户说出其一：
- 「我从没想过这个」
- 「有意思」「真的吗？」
- 主动提出新问题
- 「问题可能不是我以为的那样」

## 三层收敛封顶

1. **每 Stage 提问硬上限**：org 路 Stage 1-4 各 ≤2-3 轮，到顶无条件推进
2. **客户选择结束阶段**：Stage 3 撞 2-3 个问题后问「哪个最让你意外？」
3. **全场总轮数**：early ≤5 轮，org ≤15 轮，到顶强制收尾

## 路线图

- [x] 开场隐性分流（early/org）
- [x] 早期路径（E1-E4）
- [x] 撞击式提问（替代空问法）
- [x] 三层收敛封顶
- [x] 难度降级（L1→L2→L3）
- [x] L3 红线（只有 fact 题可用选项）
- [x] 单页面 UI（删除进度条）
- [x] 双路径输出卡
- [x] 57 个单元测试
- [x] 全路径硬收尾（v8）
- [x] 侧边栏 + 用户管理（v9）
- [x] 图片上传分析（v9）
- [x] 问题/机会双脸循环（v11）
- [x] 强化照见信「价值」段落（v18.3）
- [ ] 向量检索（embeddings）替代关键词匹配
- [ ] 自动采纳 session 为案例
- [ ] 统计裁判（跨案例规律发现）

---

*创建日期: 2024-01*
*v3.0 更新: 2026-06-08*
*v8.0 更新: 2026-06-08*
*v11.0 更新: 2026-06-09*
*v14.2 更新: 2026-06-10*
*v18.3 更新: 2026-06-11*
*理论底座: 开场分流 × 双路径 × 撞击式提问 × 全路径硬收尾 × 问题/机会双脸循环*

---

## v14.2 健壮解析器 (2026-06-10)

### 问题背景
DeepSeek API 在 `response_format: { type: 'json_object' }` + 多轮对话下频繁返回空白/纯空格响应。

### 解决方案
1. **移除 response_format** - 不再强制 JSON 输出模式
2. **JS 侧路径检测** - 当 AI 返回纯文本时，从第一条用户消息检测 path
3. **健壮解析器** - 支持 JSON / 混合文本 / 纯文本三种输出格式
4. **状态持久化** - path 一旦检测成功就保存到 state，后续轮次无需重复检测

### 路径检测关键词
| 路径 | 关键词 |
|------|--------|
| strategy | 怎么办、要不要、该不该、计划、准备、周五、demo |
| early | 没有客户、还没上线、想法阶段、没验证 |
| org | 当时、之前、已经、倒闭、客户流失、利润下滑 |
