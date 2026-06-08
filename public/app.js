/**
 * 组织镜子 - 前端逻辑 (v3 双路径架构)
 *
 * UI简化：
 * - 无进度条，后端隐性分类
 * - 支持L3选择题渲染
 * - 双路径输出卡（early / org）
 */

class OrganizationalMirror {
  constructor() {
    // 状态
    this.history = [];
    this.sessionId = null;
    this.sessionComplete = false;
    this.isLoading = false;

    // L3 选择题状态
    this.pendingOptions = null;
    this.currentDifficulty = 'L1';
    this.currentPath = 'unknown';

    // DOM 元素
    this.chatMessages = document.getElementById('chatMessages');
    this.chatContainer = document.getElementById('chatContainer');
    this.userInput = document.getElementById('userInput');
    this.sendBtn = document.getElementById('sendBtn');
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.inputContainer = document.getElementById('inputContainer');
    this.discoveryCard = document.getElementById('discoveryCard');
    this.sessionHint = document.getElementById('sessionHint');
    this.choiceOptions = document.getElementById('choiceOptions');
    this.choiceGrid = document.getElementById('choiceGrid');
    this.choiceOther = document.getElementById('choiceOther');
    this.otherInput = document.getElementById('otherInput');
    this.otherSubmit = document.getElementById('otherSubmit');

    // 绑定事件
    this.bindEvents();

    // 初始化
    this.init();
  }

  bindEvents() {
    // 发送按钮
    this.sendBtn.addEventListener('click', () => this.sendMessage());

    // 输入框事件
    this.userInput.addEventListener('input', () => {
      this.autoResize();
      this.updateSendButton();
    });

    this.userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // 重新开始按钮
    document.getElementById('restartBtn')?.addEventListener('click', () => {
      this.restart();
    });

    // 下载按钮
    document.getElementById('downloadCard')?.addEventListener('click', () => {
      alert('请使用系统截图功能保存发现卡\n\nMac: Cmd+Shift+4\nWindows: Win+Shift+S');
    });

    // 关闭发现卡按钮
    document.getElementById('closeCardBtn')?.addEventListener('click', () => {
      this.hideDiscoveryCard();
    });

    // "其他"选项提交
    this.otherSubmit?.addEventListener('click', () => {
      const customInput = this.otherInput.value.trim();
      if (customInput) {
        this.submitChoiceResponse(customInput);
      }
    });

    this.otherInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const customInput = this.otherInput.value.trim();
        if (customInput) {
          this.submitChoiceResponse(customInput);
        }
      }
    });
  }

  async init() {
    // 获取开场白
    await this.getAIResponse();
  }

  autoResize() {
    this.userInput.style.height = 'auto';
    this.userInput.style.height = Math.min(this.userInput.scrollHeight, 150) + 'px';
  }

  updateSendButton() {
    const hasContent = this.userInput.value.trim().length > 0;
    this.sendBtn.disabled = !hasContent || this.isLoading;
  }

  /**
   * 更新进度提示（自然语言，替代进度条）
   */
  updateSessionHint(hint) {
    if (!hint) {
      this.sessionHint.textContent = '';
      this.sessionHint.style.display = 'none';
      return;
    }

    const hints = {
      'approaching_end': '快要结束了...',
      'last_question': '最后一个问题'
    };

    this.sessionHint.textContent = hints[hint] || '';
    this.sessionHint.style.display = hints[hint] ? 'block' : 'none';
  }

  /**
   * 渲染L3选择题选项
   */
  renderChoiceOptions(options) {
    if (!options || options.length === 0) {
      this.hideChoiceOptions();
      return;
    }

    this.pendingOptions = options;

    // 生成选项按钮
    this.choiceGrid.innerHTML = options.map((opt, index) => {
      const key = String.fromCharCode(65 + index); // A, B, C, D...
      const isOther = opt.toLowerCase().includes('其他') || opt.toLowerCase().includes('other');
      return `
        <button class="choice-btn" data-index="${index}" data-is-other="${isOther}">
          <span class="choice-key">${key}</span>
          <span class="choice-text">${opt}</span>
        </button>
      `;
    }).join('');

    // 绑定点击事件
    this.choiceGrid.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectOption(btn));
    });

    // 显示选项区域，隐藏文本输入
    this.choiceOptions.style.display = 'block';
    this.choiceOther.style.display = 'none';
    this.inputContainer.style.display = 'none';
  }

  hideChoiceOptions() {
    this.choiceOptions.style.display = 'none';
    this.choiceOther.style.display = 'none';
    this.inputContainer.style.display = 'block';
    this.pendingOptions = null;
    this.otherInput.value = '';
  }

  selectOption(btn) {
    const index = parseInt(btn.dataset.index);
    const isOther = btn.dataset.isOther === 'true';

    // 高亮选中的选项
    this.choiceGrid.querySelectorAll('.choice-btn').forEach(b => {
      b.classList.remove('selected');
    });
    btn.classList.add('selected');

    if (isOther) {
      // 显示自定义输入框
      this.choiceOther.style.display = 'flex';
      this.otherInput.focus();
    } else {
      // 直接提交选项
      const selectedText = this.pendingOptions[index];
      setTimeout(() => this.submitChoiceResponse(selectedText), 200);
    }
  }

  submitChoiceResponse(content) {
    this.hideChoiceOptions();

    // 添加用户消息
    this.addMessage(content, 'user');
    this.history.push({ role: 'user', content });

    // 获取AI响应
    this.getAIResponse();
  }

  addMessage(content, role, isHighlight = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    if (isHighlight) {
      messageDiv.classList.add('highlight');
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;

    messageDiv.appendChild(contentDiv);

    this.chatMessages.appendChild(messageDiv);

    // 滚动到底部
    this.scrollToBottom();
  }

  addTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message ai';
    indicator.id = 'typingIndicator';
    indicator.innerHTML = `
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    `;
    this.chatMessages.appendChild(indicator);
    this.scrollToBottom();
  }

  removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
      indicator.remove();
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }, 100);
  }

  showLoading() {
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.addTypingIndicator();
  }

  hideLoading() {
    this.isLoading = false;
    this.updateSendButton();
    this.removeTypingIndicator();
  }

  async sendMessage() {
    const content = this.userInput.value.trim();
    if (!content || this.isLoading) return;

    // 添加用户消息
    this.addMessage(content, 'user');
    this.history.push({ role: 'user', content });

    // 清空输入框
    this.userInput.value = '';
    this.autoResize();
    this.updateSendButton();

    // 获取AI响应
    await this.getAIResponse();
  }

  async getAIResponse() {
    this.showLoading();

    try {
      // Use Supabase Edge Function or local API
    const apiUrl = window.CONFIG?.ENDPOINTS?.respond || '/api/respond';
    const headers = {
      'Content-Type': 'application/json'
    };
    if (window.CONFIG?.SUPABASE_ANON_KEY) {
      headers['apikey'] = window.CONFIG.SUPABASE_ANON_KEY;
      headers['Authorization'] = `Bearer ${window.CONFIG.SUPABASE_ANON_KEY}`;
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          history: this.history,
          sessionId: this.sessionId
        })
      });

      const data = await response.json();

      this.hideLoading();

      if (data.error) {
        this.addMessage('抱歉，系统遇到了问题。请刷新页面重试。', 'ai');
        return;
      }

      // 保存 sessionId
      if (data.sessionId) {
        this.sessionId = data.sessionId;
      }

      // 更新路径
      if (data.path) {
        this.currentPath = data.path;
      }

      // 更新难度
      if (data.difficulty) {
        this.currentDifficulty = data.difficulty;
      }

      // 更新进度提示
      if (data.session_hint) {
        this.updateSessionHint(data.session_hint);
      }

      // 添加AI消息
      const isHighlight = data.curiosity_triggered;
      this.addMessage(data.reply, 'ai', isHighlight);
      this.history.push({ role: 'assistant', content: data.reply });

      // 渲染L3选择题（如果有）
      if (data.options && data.options.length > 0) {
        this.renderChoiceOptions(data.options);
      } else {
        this.hideChoiceOptions();
      }

      // 检查会话是否完成
      if (data.session_complete && data.discovery_output) {
        this.completeSession(data.discovery_output, data.path);
      }

    } catch (error) {
      this.hideLoading();
      console.error('Error:', error);
      this.addMessage('网络连接出现问题，请检查后重试。', 'ai');
    }
  }

  async completeSession(discoveryOutput, path) {
    this.sessionComplete = true;

    // 隐藏输入区域
    this.inputContainer.classList.add('hidden');
    this.hideChoiceOptions();

    // 保存会话（Edge Function 已自动保存，此处为本地兼容）
    if (!window.CONFIG?.SUPABASE_URL) {
      try {
        await fetch('/api/session/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            history: this.history,
            discoveryOutput,
            path,
            sessionId: this.sessionId
          })
        });
      } catch (error) {
        console.error('Failed to save session:', error);
      }
    }

    // 显示发现卡
    if (discoveryOutput) {
      setTimeout(() => {
        this.showDiscoveryCard(discoveryOutput, path);
      }, 1500);
    }
  }

  /**
   * 显示发现卡 - 双路径支持
   */
  showDiscoveryCard(output, path) {
    const cardContent = document.getElementById('cardContent');
    const cardTitle = document.getElementById('cardTitle');

    if (path === 'early') {
      // 早期路径输出卡
      cardTitle.textContent = '你的验证计划';
      cardContent.innerHTML = this.buildEarlyPathCard(output);
    } else {
      // 组织路径输出卡
      cardTitle.textContent = '你的发现';
      cardContent.innerHTML = this.buildOrgPathCard(output);
    }

    // 添加遮罩
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.id = 'cardOverlay';
    document.body.appendChild(overlay);

    // 显示卡片
    this.discoveryCard.style.display = 'block';
  }

  /**
   * 构建早期路径输出卡
   */
  buildEarlyPathCard(output) {
    return `
      <div class="card-field">
        <label>当前想法/挑战</label>
        <p>${output.current_idea || output.current_problem || '—'}</p>
      </div>
      <div class="card-field">
        <label>核心假设</label>
        <p>${output.core_assumption || '—'}</p>
      </div>
      <div class="card-field highlight">
        <label>被撬动的假设</label>
        <p>${output.challenged_assumption || '—'}</p>
      </div>
      <div class="card-field">
        <label>你的预测</label>
        <p>${output.prediction || '—'}</p>
      </div>
      <div class="card-field">
        <label>验证成功定义</label>
        <p>${output.success_definition || '—'}</p>
      </div>
      <div class="card-field highlight">
        <label>更新后的问题定义</label>
        <p>${output.redefined_problem || '—'}</p>
      </div>
      <div class="card-section experiment-section">
        <h3>你的7天验证实验</h3>
        <div class="card-field">
          <label>最小验证</label>
          <p>${output.seven_day_experiment?.experiment || '—'}</p>
        </div>
        <div class="card-field">
          <label>成功标准</label>
          <p>${output.seven_day_experiment?.success_criteria || '—'}</p>
        </div>
        <div class="card-row">
          <div class="card-field half">
            <label>时间</label>
            <p>${output.seven_day_experiment?.time_horizon || '7天'}</p>
          </div>
          <div class="card-field half">
            <label>负责人</label>
            <p>${output.seven_day_experiment?.owner || '你'}</p>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 构建组织路径输出卡
   */
  buildOrgPathCard(output) {
    // 因果链渲染
    let causalChainHtml = '—';
    if (output.world_model?.causal_chain && output.world_model.causal_chain.length > 0) {
      causalChainHtml = output.world_model.causal_chain
        .map((item, i) => {
          const isLast = i === output.world_model.causal_chain.length - 1;
          return `<span class="mini-chain-node">${item}</span>${isLast ? '' : '<span class="mini-chain-arrow">→</span>'}`;
        })
        .join('');
    }

    return `
      <div class="card-field">
        <label>当前问题定义</label>
        <p>${output.current_problem || '—'}</p>
      </div>
      <div class="card-field">
        <label>当前世界模型（因果链）</label>
        <div class="world-model-content">
          <div class="mini-causal-chain">${causalChainHtml}</div>
        </div>
      </div>
      <div class="card-field">
        <label>隐藏假设</label>
        <p>${output.world_model?.hidden_assumptions?.join('；') || '—'}</p>
      </div>
      <div class="card-field highlight">
        <label>可能缺失的变量</label>
        <p>${output.missing_variables?.join('、') || '—'}</p>
      </div>
      <div class="card-field">
        <label>好奇问题</label>
        <p>${output.curiosity_questions?.join('；') || '—'}</p>
      </div>
      <div class="card-field highlight">
        <label>更新后的问题定义</label>
        <p>${output.redefined_problem || '—'}</p>
      </div>
      <div class="card-section experiment-section">
        <h3>你的7天实验</h3>
        <div class="card-field">
          <label>假设</label>
          <p>${output.seven_day_experiment?.hypothesis || '—'}</p>
        </div>
        <div class="card-field">
          <label>实验</label>
          <p>${output.seven_day_experiment?.experiment || '—'}</p>
        </div>
        <div class="card-field">
          <label>成功标准</label>
          <p>${output.seven_day_experiment?.success_criteria || '—'}</p>
        </div>
        <div class="card-row">
          <div class="card-field half">
            <label>时间</label>
            <p>${output.seven_day_experiment?.time_horizon || '—'}</p>
          </div>
          <div class="card-field half">
            <label>负责人</label>
            <p>${output.seven_day_experiment?.owner || '—'}</p>
          </div>
        </div>
      </div>
    `;
  }

  hideDiscoveryCard() {
    this.discoveryCard.style.display = 'none';
    const overlay = document.getElementById('cardOverlay');
    if (overlay) {
      overlay.remove();
    }
  }

  restart() {
    // 重置状态
    this.history = [];
    this.sessionId = null;
    this.sessionComplete = false;
    this.pendingOptions = null;
    this.currentDifficulty = 'L1';
    this.currentPath = 'unknown';

    // 重置UI
    this.chatMessages.innerHTML = '';
    this.inputContainer.classList.remove('hidden');
    this.inputContainer.style.display = 'block';
    this.hideDiscoveryCard();
    this.hideChoiceOptions();
    this.updateSessionHint(null);

    // 获取新的开场白
    this.init();
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new OrganizationalMirror();
});
