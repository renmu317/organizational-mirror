# 组织镜子 (Organizational Mirror) v1 实现计划

## 项目概览

一个让企业领导者**自己发现**组织真实瓶颈的 AI 咨询对话工具。

**核心铁律：**
- 绝不诊断、绝不暴露理论标签、绝不暴露案例库
- 答案永远由客户自己得出

**技术栈：** Node.js + Express + DeepSeek API + 原生前端

---

## 文件结构

```
/Users/renmu/企业组织认知系统/organizational-mirror/
├── .env.example              # DEEPSEEK_API_KEY=sk-...
├── .gitignore                # .env, data/sessions.json, 原始xlsx
├── package.json
├── server.js                 # Express 后端
├── scripts/
│   └── import.js             # xlsx → 匿名化 → caseLibrary.json
├── prompts/
│   └── consultant.js         # 系统提示词
├── data/
│   ├── caseLibrary.json      # 案例库（由 import.js 生成）
│   └── sessions.json         # 对话记录（自动生成）
└── public/
    ├── index.html            # 4页流程 UI
    ├── styles.css            # McKinsey 极简风格
    └── app.js                # 前端逻辑
```

---

## 实现步骤

### Step 1: 项目初始化
- 创建目录结构
- package.json (依赖: express, dotenv, xlsx, openai)
- .env.example 和 .gitignore

### Step 2: 导入脚本 (scripts/import.js)

**采集表列映射：**
| 列号 | 采集表列名 | → 目标字段 |
|------|-----------|-----------|
| 4 | 行业 | industry |
| 5 | 企业规模人数 | company_size |
| 6 | 企业状态 | company_state |
| 8 | 企业遇到的问题 | surface_problem |
| 9+10 | 老板认为的问题 + 为什么 | initial_explanation |
| 11 | 关键决策 | failed_action |
| 18 | 是否更新方法/目标 | recovery_type |
| 21 | 是否发现真正问题 | real_bottleneck |
| 22 | 认知来源 | cognition_source |
| 24 | 如果重来 | effective_action |

**匿名化规则：**
- 删除：列2(企业名称)、列3(实际控制人)、列23(认知来源名字)
- 生成代号：`行业·规模·C001`

**自动判级逻辑：**
```
if (initial_explanation && real_bottleneck && recovery_type) {
  if (key_questions 非空) → enriched
  else → gap
} else → skeleton
```

### Step 3: 系统提示词 (prompts/consultant.js)

按规格书 §6 原样实现，关键点：
- 禁止使用理论标签词
- 动态追问优先（不是固定问卷）
- 撬假设（双循环）+ 埋预测（贝叶斯）
- 输出 JSON 格式：{ reply, page, internal_note, session_complete }

### Step 4: 后端服务 (server.js)

**API 端点：**
- `POST /api/respond` - 核心对话接口
  1. 接收 { history, page }
  2. 按 completeness ≥ gap 检索案例
  3. 匹配维度：industry + surface_problem关键词 + recovery_type
  4. 取 top-3 案例的 key_questions 作为「提问灵感」
  5. 调用 DeepSeek API
  6. 返回 AI 响应

- `POST /api/session/save` - 保存完成的对话

**DeepSeek API 配置：**
```javascript
baseURL: 'https://api.deepseek.com'
model: 'deepseek-chat'
```

### Step 5: 前端 UI (public/)

**4 页流程：**
1. Page 1: 问题卡（取材）
2. Page 2: 认知对抗（撬假设 + 埋预测）
3. Page 3: 摩擦定位（场景化提问）
4. Page 4: 适应实验 + Recovery 身份

**UI 风格：**
- 白底黑字极简 McKinsey 风
- 细线进度条
- 对话式输入框
- 结尾只呈现「适应实验卡」

---

## 关键文件详细设计

### server.js 案例检索逻辑
```javascript
function searchCases(history, page) {
  // 只检索 gap 或 enriched 级别
  const activeCases = cases.filter(c =>
    c.completeness === 'gap' || c.completeness === 'enriched'
  );

  // 提取用户对话中的关键词
  const userText = history.filter(m => m.role === 'user').map(m => m.content).join(' ');

  // 匹配打分
  return activeCases
    .map(c => ({
      ...c,
      score: calculateMatchScore(c, userText)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
```

### prompts/consultant.js 输入格式
```javascript
// 注入到系统提示词的案例灵感（用户永远看不到）
const caseHints = topCases.map(c => ({
  initial_explanation: c.initial_explanation,
  real_bottleneck: c.real_bottleneck,
  key_questions: c.key_questions || []
}));
```

---

## 验证方式

1. **导入脚本验证：**
   ```bash
   node scripts/import.js "/Users/renmu/企业组织认知系统/企业认知决策问题数据收集表(2)(1).xlsx"
   ```
   - 检查控制台输出：总条数 / gap 数 / enriched 数 / skeleton 数
   - 检查 data/caseLibrary.json 内容（无真实姓名/公司名）

2. **服务启动验证：**
   ```bash
   cp .env.example .env
   # 填入 DEEPSEEK_API_KEY
   npm install
   npm start
   ```
   - 访问 http://localhost:3000
   - 完成一次完整 4 页对话
   - 检查 AI 是否：
     - 动态追问（不是念问卷）
     - 从不说「你的问题是X」
     - 从不使用理论标签词
     - 最后输出适应实验卡

3. **成功标准：**
   对话结束时客户能说出：
   - 「我从没这样想过」
   - 「问题可能不是我以为的那样」

---

## 执行顺序

1. Step 1: 项目初始化（package.json, .env.example, .gitignore）
2. Step 2: scripts/import.js（导入脚本）
3. Step 3: prompts/consultant.js（系统提示词）
4. Step 4: server.js（后端服务）
5. Step 5: public/（前端 UI）
6. 运行 import.js 生成 caseLibrary.json
7. 启动服务测试

---

## 注意事项

- DeepSeek API 使用 OpenAI 兼容格式
- API Key 只在后端读取，永不提交到仓库
- 活跃库只计 gap 级以上案例，README 要说明这一点
- v2 路线：向量检索（embeddings）、自动采纳 session 为案例
