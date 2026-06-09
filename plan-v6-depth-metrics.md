# 对话深度指标 v6 - 实现方案

> 基于 v5 的 `cognition_layer` 字段，计算每场对话的认知深度，并在后台展示统计面板。

---

## 1. 设计概述

### 1.1 深度定义（非轮数）

| 层级 | 深度值 |
|------|--------|
| result | 1 |
| behavior | 2 |
| decision | 3 |
| assumption | 4 |
| environment | 5 |
| rule | 6 |

**单场深度 `max_depth`** = 该场所有轮次 `cognition_layer` 的最大值

### 1.2 关键指标

| 指标 | 定义 | 意义 |
|------|------|------|
| `max_depth` | 最深层级（1-6） | 对话深度 |
| `broke_assumption` | max_depth >= 4 | 是否突破认知假设层 |
| `reached_rule` | max_depth == 6 | 是否到达规则层 |
| `layer_sequence` | 每轮 cognition_layer 序列 | 轨迹分析 |
| `turns` | 总轮数 | 对比深度用 |

---

## 2. 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `server.js` | 1. 添加深度计算函数<br>2. 修改 session 保存逻辑<br>3. 新增深度统计 API<br>4. 修改 /api/respond 收集 layer_sequence |
| `public/admin.html` | 新增统计后台页面 |
| `public/admin.js` | 后台面板逻辑 |
| `public/styles.css` | 后台样式 |

---

## 3. 详细实现

### 3.1 server.js 修改

#### 3.1.1 添加深度映射常量

```javascript
// ============================================================
// 认知深度映射（v6）
// ============================================================
const LAYER_DEPTH_MAP = {
  'result': 1,
  'behavior': 2,
  'decision': 3,
  'assumption': 4,
  'environment': 5,
  'rule': 6
};
```

#### 3.1.2 添加深度计算函数

```javascript
// ============================================================
// 计算对话深度指标（v6）
// ============================================================
function calculateDepthMetrics(layerSequence) {
  if (!layerSequence || layerSequence.length === 0) {
    return {
      layer_sequence: [],
      max_depth: 0,
      broke_assumption: false,
      reached_rule: false,
      turns: 0
    };
  }

  const depths = layerSequence.map(layer => LAYER_DEPTH_MAP[layer] || 1);
  const maxDepth = Math.max(...depths);

  return {
    layer_sequence: layerSequence,
    max_depth: maxDepth,
    broke_assumption: maxDepth >= 4,  // 假设层及以上
    reached_rule: maxDepth === 6,      // 规则层
    turns: layerSequence.length
  };
}
```

#### 3.1.3 修改 getOrCreateState 添加 layer_sequence 收集

在现有 state 中添加：
```javascript
layer_sequence: []  // 收集每轮的 cognition_layer
```

#### 3.1.4 修改 updateCognitionTracking 记录 layer_sequence

```javascript
// 在 updateCognitionTracking 末尾添加
state.layer_sequence.push(detection.layer);
```

#### 3.1.5 修改 /api/session/save 计算深度指标

```javascript
// 在 session 对象中添加深度指标
const depthMetrics = path === 'org'
  ? calculateDepthMetrics(/* 从 history 或请求中获取 layer_sequence */)
  : null;  // early 路径不计算六层深度

const session = {
  // ...现有字段
  // 新增深度指标（仅 org 路径）
  depth_metrics: depthMetrics
};
```

#### 3.1.6 新增深度统计 API

```javascript
// ============================================================
// 对话深度统计（v6）
// ============================================================
app.get('/api/stats/depth', (req, res) => {
  const sessions = loadSessions();

  // 只统计 org 路径且有深度数据的会话
  const orgSessions = sessions.filter(s =>
    s.path === 'org' && s.depth_metrics
  );

  if (orgSessions.length === 0) {
    return res.json({
      sample_size: 0,
      warning: '样本不足，暂无数据',
      avg_depth: null,
      broke_assumption_rate: null,
      reached_rule_rate: null,
      depth_distribution: null
    });
  }

  // 计算统计
  const depths = orgSessions.map(s => s.depth_metrics.max_depth);
  const avgDepth = (depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1);

  const brokeAssumptionCount = orgSessions.filter(s => s.depth_metrics.broke_assumption).length;
  const reachedRuleCount = orgSessions.filter(s => s.depth_metrics.reached_rule).length;

  // 深度分布
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  depths.forEach(d => distribution[d]++);

  // 深度 vs 轮数对比（用于识别"轮数高但深度低"）
  const depthVsTurns = orgSessions.map(s => ({
    id: s.id,
    max_depth: s.depth_metrics.max_depth,
    turns: s.depth_metrics.turns,
    shallow_high_turns: s.depth_metrics.max_depth <= 3 && s.depth_metrics.turns >= 6
  }));

  const shallowHighTurnsCount = depthVsTurns.filter(d => d.shallow_high_turns).length;

  res.json({
    sample_size: orgSessions.length,
    warning: orgSessions.length < 20 ? '样本不足（<20），仅供参考' : null,
    avg_depth: parseFloat(avgDepth),
    broke_assumption_rate: ((brokeAssumptionCount / orgSessions.length) * 100).toFixed(1) + '%',
    reached_rule_rate: ((reachedRuleCount / orgSessions.length) * 100).toFixed(1) + '%',
    depth_distribution: distribution,
    depth_vs_turns: {
      shallow_high_turns_count: shallowHighTurnsCount,
      shallow_high_turns_rate: ((shallowHighTurnsCount / orgSessions.length) * 100).toFixed(1) + '%',
      details: depthVsTurns.slice(0, 10)  // 返回最近10条
    }
  });
});
```

### 3.2 前端统计后台

#### 3.2.1 public/admin.html

创建新的统计后台页面，包含：
- 对话深度面板（核心）
- 案例库统计（现有）
- 使用说明（§4 的内容）

#### 3.2.2 面板组件

```html
<div class="depth-panel">
  <h2>对话深度统计</h2>

  <!-- 样本警告 -->
  <div class="warning-banner" id="sampleWarning" style="display:none;">
    ⚠️ 样本不足（<20），数据仅供参考
  </div>

  <!-- 核心指标卡片 -->
  <div class="metrics-grid">
    <div class="metric-card">
      <span class="metric-value" id="avgDepth">--</span>
      <span class="metric-label">平均深度</span>
    </div>
    <div class="metric-card highlight">
      <span class="metric-value" id="brokeAssumptionRate">--</span>
      <span class="metric-label">假设突破率 ⭐</span>
    </div>
    <div class="metric-card">
      <span class="metric-value" id="reachedRuleRate">--</span>
      <span class="metric-label">规则到达率</span>
    </div>
  </div>

  <!-- 深度分布图 -->
  <div class="depth-distribution">
    <h3>深度分布</h3>
    <div class="bar-chart" id="depthChart">
      <!-- 动态生成柱状图 -->
    </div>
  </div>

  <!-- 深度 vs 轮数警告 -->
  <div class="depth-turns-alert" id="depthTurnsAlert">
    <h3>⚠️ 浅层空转警告</h3>
    <p>有 <span id="shallowHighTurnsCount">0</span> 场对话（<span id="shallowHighTurnsRate">0%</span>）轮数≥6 但深度≤3</p>
    <p class="hint">这意味着对话在浅层打转，提问话术可能需要调整</p>
  </div>

  <!-- 用途说明 -->
  <div class="usage-note">
    <h3>📊 指标用途</h3>
    <ul>
      <li><strong>这是观测仪表盘，不是 AI 的 KPI</strong></li>
      <li>假设突破率高 = 真在产生认知重构</li>
      <li>普遍卡在 decision 层 = 假设追问话术需改进</li>
      <li>max_depth 高的对话 = 高质量种子案例</li>
    </ul>
  </div>
</div>
```

---

## 4. 早期路径处理（§5）

早期路径不使用六层深度，单独标记：

```javascript
// early 路径的达标指标
const earlyMetrics = {
  challenged_assumption: /* 是否撬动"先造后验"假设 */,
  has_experiment: /* 是否产出可验证实验 */,
  is_qualified: /* 两者都为 true */
};
```

在统计 API 中分开返回：
```javascript
{
  org_depth_stats: { /* 六层深度统计 */ },
  early_stats: {
    total: 10,
    qualified_rate: '70%'  // 产出实验 + 撬动假设的比例
  }
}
```

---

## 5. 验收清单

| # | 验收项 | 预期结果 |
|---|--------|---------|
| 1 | 序列 `[result,behavior,behavior,decision,assumption,rule]` | max_depth = 6 |
| 2 | 序列 `[result,behavior,decision]` | max_depth = 3 |
| 3 | 序列 `[result,behavior,behavior,behavior,behavior,behavior]` (6轮全行为层) | max_depth = 2 ✓ |
| 4 | 后台面板显示平均深度 | 数值正确 |
| 5 | 后台面板显示假设突破率 | 百分比正确 |
| 6 | 后台面板显示规则到达率 | 百分比正确 |
| 7 | 后台面板显示深度分布柱状图 | 6个柱子 |
| 8 | 识别"轮数高但深度低"的场次 | 有提示 |
| 9 | early 路径不进 org 深度统计 | 分开统计 |
| 10 | 样本 < 20 显示诚实警告 | 警告显示 |

---

## 6. 实现顺序

### Phase 1: 后端核心（server.js）
1. 添加 LAYER_DEPTH_MAP 常量
2. 添加 calculateDepthMetrics 函数
3. 修改 state 添加 layer_sequence 字段
4. 修改 updateCognitionTracking 记录每轮层级
5. 修改 /api/respond 在响应中返回 layer_sequence
6. 修改 /api/session/save 计算并存储深度指标
7. 新增 /api/stats/depth API

### Phase 2: 前端面板
1. 创建 admin.html 页面
2. 创建 admin.js 逻辑
3. 添加样式
4. 实现深度分布柱状图

### Phase 3: 测试验收
1. 单元测试深度计算函数
2. API 测试
3. 面板功能测试
4. 验收清单逐项确认

---

## 7. 风险与注意

1. **不要让 AI 刷深度** — 这是观测指标，不是奖励信号
2. **历史会话无 layer_sequence** — 需要兼容处理
3. **early 路径单独处理** — 不混入 org 统计
4. **小样本诚实** — 样本 < 20 必须警告

---

*深度 = 挖到多深，不是聊了多久。假设突破率是核心。*
