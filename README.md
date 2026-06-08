# Organizational Mirror 组织镜子

一个让企业领导者**自己发现**组织真实瓶颈的 AI 咨询对话工具。

## 核心理念

- **绝不诊断** — AI 永远不说「你的问题是 X」
- **绝不暴露理论标签** — 客户界面上永不出现专业术语
- **绝不暴露案例库** — 案例库是问题生成引擎，不是答案库
- **答案永远由客户自己得出**

成功标志：客户说出「我从没这样想过」或「问题可能不是我以为的那样」。

## 快速开始

### 1. 安装依赖

```bash
cd organizational-mirror
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 DeepSeek API Key：

```
DEEPSEEK_API_KEY=sk-your-api-key-here
```

### 3. 导入案例库

```bash
node scripts/import.js "/path/to/企业认知决策问题数据收集表.xlsx"
```

导入完成后会显示统计：

```
活跃库条数:       XX ← 这才是真正可用的案例数
```

> **重要**：只有 `gap` 及以上级别的案例才会参与检索。`skeleton` 级别的案例仅存档，不参与对话。

### 4. 启动服务

```bash
npm start
```

访问 http://localhost:3000

## 案例库分级

| 级别 | 含义 | 进入活跃库 |
|------|------|-----------|
| `skeleton` | 空壳，缺少关键字段 | ❌ 不参与检索 |
| `gap` | 已捕捉到「认知缝」 | ✅ 参与检索 |
| `enriched` | 精修，含手工问题 | ✅ 优先使用 |

### 升级案例

在采集表中补全以下字段后重新运行导入脚本：

- `initial_explanation` — 老板最初的归因
- `real_bottleneck` — 实际问题（由导入脚本自动提取枚举）
- `recovery_type` — 换目标 or 换方法

## 对话流程（4页）

1. **问题卡** — 取材，了解表面问题
2. **假设** — 撬动假设，埋入预测
3. **摩擦** — 场景化探查组织摩擦点
4. **实验** — Recovery 身份 + 最小适应实验

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/respond` | POST | 核心对话接口 |
| `/api/session/save` | POST | 保存完成的对话 |
| `/api/stats` | GET | 案例库统计 |
| `/api/health` | GET | 健康检查 |

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JS
- **AI**: DeepSeek API (deepseek-chat)
- **存储**: JSON 文件

## v2 路线图

- [ ] 向量检索（embeddings）替代关键词匹配
- [ ] 自动采纳完成的 session 为案例
- [ ] 7 天 follow-up 回访机制
- [ ] 统计裁判（跨案例规律发现）

## 注意事项

- API Key 只在后端读取，永不提交到仓库
- `.gitignore` 已包含 `.env`、`sessions.json`、原始 xlsx 文件
- 活跃库条数才是真实可用的案例数，总条数包含空壳

---

*理论底座：贝叶斯学习 × 双循环学习 × 组织适应理论*
