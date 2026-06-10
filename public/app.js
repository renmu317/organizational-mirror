/**
 * 组织镜子 - 前端逻辑 (v12 策略型分流)
 *
 * v12 新增：
 * - 新增 strategy 路径输出卡
 * - buildStrategyPathCard 函数
 *
 * v11 新增：
 * - 发现卡末尾显示「下一道缝」机会钩
 * - pull 式措辞（"如果你想..."）
 *
 * v9 新增：
 * - 开场姓名弹窗
 * - 历史会话侧边栏
 * - 会话回看功能
 * - 移动端汉堡菜单
 */

class OrganizationalMirror {
  constructor() {
    // 状态
    this.history = [];
    this.sessionId = null;
    this.sessionComplete = false;
    this.isLoading = false;

    // 【v9】用户状态
    this.currentUser = null;
    this.sessions = [];
    this.viewingSessionId = null;  // 正在回看的会话 ID
    this.isReplayMode = false;

    // 【v9】图片上传状态
    this.pendingImage = null;  // { base64, file }

    // L3 选择题状态
    this.pendingOptions = null;
    this.currentDifficulty = 'L1';
    this.currentPath = 'unknown';

    // 报告数据（用于下载）
    this.lastDiscoveryOutput = null;
    this.lastPath = null;

    // DOM 元素
    this.appContainer = document.getElementById('appContainer');
    this.welcomeHero = document.getElementById('welcomeHero');
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
    this.endSessionBtn = document.getElementById('endSessionBtn');

    // 【v9】侧边栏元素
    this.sidebar = document.getElementById('sidebar');
    this.sidebarSessions = document.getElementById('sidebarSessions');
    this.sidebarUserName = document.getElementById('sidebarUserName');
    this.newChatBtn = document.getElementById('newChatBtn');
    this.hamburgerBtn = document.getElementById('hamburgerBtn');

    // 【v9】姓名弹窗元素
    this.nameModalOverlay = document.getElementById('nameModalOverlay');
    this.nameInput = document.getElementById('nameInput');
    this.companyInput = document.getElementById('companyInput');
    this.nameSubmitBtn = document.getElementById('nameSubmitBtn');

    // 【v9】图片上传元素
    this.uploadBtn = document.getElementById('uploadBtn');
    this.imageInput = document.getElementById('imageInput');
    this.imagePreviewContainer = document.getElementById('imagePreviewContainer');
    this.previewImg = document.getElementById('previewImg');
    this.removeImageBtn = document.getElementById('removeImageBtn');

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
      this.downloadReport();
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

    // 【v8】结束会话按钮
    this.endSessionBtn?.addEventListener('click', () => {
      this.endSession();
    });

    // 【v9】姓名弹窗事件
    this.nameInput?.addEventListener('input', () => {
      this.nameSubmitBtn.disabled = !this.nameInput.value.trim();
    });

    this.nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.nameInput.value.trim()) {
        e.preventDefault();
        this.submitUserName();
      }
    });

    this.nameSubmitBtn?.addEventListener('click', () => {
      this.submitUserName();
    });

    // 【v9】侧边栏事件
    this.newChatBtn?.addEventListener('click', () => {
      this.startNewChat();
    });

    this.hamburgerBtn?.addEventListener('click', () => {
      this.toggleSidebar();
    });

    // 点击遮罩关闭侧边栏
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('sidebar-overlay')) {
        this.closeSidebar();
      }
    });

    // 【v9】图片上传事件
    this.uploadBtn?.addEventListener('click', () => {
      this.imageInput.click();
    });

    this.imageInput?.addEventListener('change', (e) => {
      this.handleImageSelect(e);
    });

    this.removeImageBtn?.addEventListener('click', () => {
      this.clearPendingImage();
    });
  }

  async init() {
    // 【v9】检查本地存储的用户信息
    const savedUser = localStorage.getItem('mirror_user');

    if (savedUser) {
      try {
        this.currentUser = JSON.parse(savedUser);
        this.onUserReady();
      } catch (e) {
        localStorage.removeItem('mirror_user');
        this.showNameModal();
      }
    } else {
      this.showNameModal();
    }
  }

  // 【v9】显示姓名弹窗
  showNameModal() {
    this.nameModalOverlay.style.display = 'flex';
    this.nameInput.focus();
  }

  // 【v9】隐藏姓名弹窗
  hideNameModal() {
    this.nameModalOverlay.style.display = 'none';
  }

  // 【v9】提交用户姓名
  async submitUserName() {
    const name = this.nameInput.value.trim();
    const company = this.companyInput.value.trim();

    if (!name) return;

    this.nameSubmitBtn.disabled = true;
    this.nameSubmitBtn.textContent = 'Loading...';

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, company })
      });

      const data = await response.json();

      if (data.error) {
        alert('Failed to create user: ' + data.error);
        this.nameSubmitBtn.disabled = false;
        this.nameSubmitBtn.textContent = 'Start Conversation';
        return;
      }

      this.currentUser = data.user;
      localStorage.setItem('mirror_user', JSON.stringify(this.currentUser));

      this.hideNameModal();
      this.onUserReady();

    } catch (error) {
      console.error('Error creating user:', error);
      alert('Network error. Please try again.');
      this.nameSubmitBtn.disabled = false;
      this.nameSubmitBtn.textContent = 'Start Conversation';
    }
  }

  // 【v9】用户就绪后的初始化
  async onUserReady() {
    // 显示用户名
    if (this.sidebarUserName) {
      this.sidebarUserName.textContent = this.currentUser.name;
    }

    // 加载历史会话
    await this.loadSessions();
  }

  // 【v9】加载历史会话列表
  async loadSessions() {
    if (!this.currentUser?.id) return;

    try {
      const response = await fetch(`/api/sessions?user_id=${this.currentUser.id}`);
      const data = await response.json();

      if (data.sessions) {
        this.sessions = data.sessions;
        this.renderSessionList();
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  }

  // 【v9】渲染会话列表
  renderSessionList() {
    if (!this.sidebarSessions) return;

    if (this.sessions.length === 0) {
      this.sidebarSessions.innerHTML = '<div class="sidebar-empty">No conversations yet</div>';
      return;
    }

    this.sidebarSessions.innerHTML = this.sessions.map(session => {
      const date = new Date(session.created_at);
      const dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      });
      const title = session.title || 'New conversation';
      const isActive = session.id === this.viewingSessionId;

      return `
        <div class="session-item ${isActive ? 'active' : ''}" data-id="${session.id}">
          <span class="session-item-title">${this.escapeHtml(title)}</span>
          <span class="session-item-date">${dateStr}</span>
        </div>
      `;
    }).join('');

    // 绑定点击事件
    this.sidebarSessions.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', () => {
        const sessionId = item.dataset.id;
        this.viewSession(sessionId);
      });
    });
  }

  // 【v9】查看历史会话
  async viewSession(sessionId) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`);
      const data = await response.json();

      if (data.error) {
        console.error('Error loading session:', data.error);
        return;
      }

      const session = data.session;

      // 设置回看模式
      this.isReplayMode = true;
      this.viewingSessionId = sessionId;
      this.appContainer.classList.add('replay-mode');

      // 清空并渲染历史消息
      this.chatMessages.innerHTML = '';
      this.appContainer.classList.add('has-messages');

      if (session.history && Array.isArray(session.history)) {
        session.history.forEach(msg => {
          this.addMessage(msg.content, msg.role === 'user' ? 'user' : 'ai');
        });
      }

      // 更新侧边栏选中状态
      this.renderSessionList();

      // 添加回看提示横幅
      this.showReplayBanner();

      // 移动端关闭侧边栏
      this.closeSidebar();

      // 如果有发现卡，显示它
      if (session.discovery_output) {
        this.lastDiscoveryOutput = session.discovery_output;
        this.lastPath = session.path;
      }

    } catch (error) {
      console.error('Error viewing session:', error);
    }
  }

  // 【v9】显示回看提示横幅
  showReplayBanner() {
    // 移除已有的横幅
    const existingBanner = document.querySelector('.replay-banner');
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.className = 'replay-banner';
    banner.innerHTML = `
      <p>You are viewing a past conversation</p>
      <button class="btn-primary" id="replayNewChatBtn">Start New Conversation</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('replayNewChatBtn')?.addEventListener('click', () => {
      this.startNewChat();
    });
  }

  // 【v9】隐藏回看横幅
  hideReplayBanner() {
    const banner = document.querySelector('.replay-banner');
    if (banner) banner.remove();
  }

  // 【v9】开始新对话
  startNewChat() {
    this.isReplayMode = false;
    this.viewingSessionId = null;
    this.appContainer.classList.remove('replay-mode');
    this.hideReplayBanner();
    this.restart();
    this.renderSessionList();
    this.closeSidebar();
  }

  // 【v9】切换侧边栏
  toggleSidebar() {
    this.sidebar.classList.toggle('open');
    this.hamburgerBtn.classList.toggle('open');

    // 添加/移除遮罩
    let overlay = document.querySelector('.sidebar-overlay');
    if (this.sidebar.classList.contains('open')) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay show';
        document.body.appendChild(overlay);
      }
    } else {
      if (overlay) overlay.remove();
    }
  }

  // 【v9】关闭侧边栏
  closeSidebar() {
    this.sidebar.classList.remove('open');
    this.hamburgerBtn.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.remove();
  }

  // 【v9】HTML 转义
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 【v9】处理图片选择
  handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 检查文件类型
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      alert('Please select a JPG, PNG, or WebP image.');
      return;
    }

    // 检查文件大小（5MB）
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('Image must be smaller than 5MB.');
      return;
    }

    // 转换为 base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result;
      this.pendingImage = { base64, file };

      // 显示预览
      this.previewImg.src = base64;
      this.imagePreviewContainer.style.display = 'block';

      // 更新发送按钮状态
      this.updateSendButton();
    };
    reader.readAsDataURL(file);
  }

  // 【v9】清除待发送图片
  clearPendingImage() {
    this.pendingImage = null;
    this.imageInput.value = '';
    this.imagePreviewContainer.style.display = 'none';
    this.previewImg.src = '';
    this.updateSendButton();
  }

  // 【v9】构建包含图片的消息内容
  buildMessageContent(text, imageBase64) {
    if (!imageBase64) {
      return text;
    }

    // 返回多模态内容格式
    return [
      { type: 'text', text: text || '' },
      {
        type: 'image_url',
        image_url: { url: imageBase64 }
      }
    ];
  }

  autoResize() {
    this.userInput.style.height = 'auto';
    this.userInput.style.height = Math.min(this.userInput.scrollHeight, 150) + 'px';
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

  addMessage(content, role, isHighlight = false, hasImage = false) {
    // 添加第一条消息时切换到对话模式
    if (!this.appContainer.classList.contains('has-messages')) {
      this.appContainer.classList.add('has-messages');
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    if (isHighlight) {
      messageDiv.classList.add('highlight');
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // 【v9】处理包含图片的消息
    if (Array.isArray(content)) {
      // 多模态消息
      content.forEach(item => {
        if (item.type === 'image_url' && item.image_url?.url) {
          const img = document.createElement('img');
          img.src = item.image_url.url;
          img.className = 'message-image';
          img.alt = 'Uploaded image';
          contentDiv.appendChild(img);
        } else if (item.type === 'text' && item.text) {
          const textNode = document.createElement('p');
          textNode.textContent = item.text;
          contentDiv.appendChild(textNode);
        }
      });
    } else {
      // 纯文本消息
      contentDiv.textContent = content;
    }

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

  async getAIResponse(endRequested = false) {
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
          sessionId: this.sessionId,
          userId: this.currentUser?.id || null, // 【v9】传递用户 ID
          endRequested: endRequested // 【v8】用户请求结束
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

      // 【v8】显示/隐藏结束按钮（有消息且未完成时显示）
      this.updateEndSessionButton(data.session_complete);

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
        // 【v8】记录收尾原因
        if (data.close_reason) {
          console.log(`[v8] Session closed: ${data.close_reason}`);
        }
        // 【v6】传递深度指标
        this.completeSession(data.discovery_output, data.path, data.layer_sequence, data.depth_metrics);
      }

    } catch (error) {
      this.hideLoading();
      console.error('Error:', error);
      this.addMessage('网络连接出现问题，请检查后重试。', 'ai');
    }
  }

  /**
   * 【v8】更新结束按钮显示状态
   */
  updateEndSessionButton(sessionComplete) {
    if (this.endSessionBtn) {
      // 有对话且未完成时显示
      const shouldShow = this.history.length >= 2 && !sessionComplete && !this.sessionComplete;
      this.endSessionBtn.style.display = shouldShow ? 'block' : 'none';
    }
  }

  /**
   * 【v8】用户主动结束会话
   */
  async endSession() {
    if (this.isLoading || this.sessionComplete) return;

    // 禁用按钮防止重复点击
    if (this.endSessionBtn) {
      this.endSessionBtn.disabled = true;
    }

    // 发送带 endRequested 标记的请求
    await this.getAIResponse(true);
  }

  async completeSession(discoveryOutput, path, layerSequence, depthMetrics) {
    this.sessionComplete = true;

    // 隐藏输入区域和结束按钮
    this.inputContainer.classList.add('hidden');
    this.hideChoiceOptions();
    this.updateEndSessionButton(true); // 【v8】隐藏结束按钮

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
            sessionId: this.sessionId,
            // 【v6】深度指标
            layer_sequence: layerSequence || [],
            depth_metrics: depthMetrics || null,
            // 【v9】关联用户
            user_id: this.currentUser?.id || null
          })
        });

        // 【v9】刷新会话列表
        await this.loadSessions();

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
    // 保存报告数据供下载使用
    this.lastDiscoveryOutput = output;
    this.lastPath = path;

    const cardContent = document.getElementById('cardContent');
    const cardTitle = document.getElementById('cardTitle');

    if (path === 'early') {
      // 早期路径输出卡
      cardTitle.textContent = '你的验证计划';
      cardContent.innerHTML = this.buildEarlyPathCard(output);
    } else if (path === 'strategy') {
      // 【v12】策略型输出卡
      cardTitle.textContent = '你的决策';
      cardContent.innerHTML = this.buildStrategyPathCard(output);
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
    let html = `
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

    // 【v11】机会钩（仅当有值时显示）
    if (output.next_gap_hook) {
      html += `
        <div class="card-field next-gap-hook">
          <label>下一道缝（如果你想）</label>
          <p class="pull-style">${output.next_gap_hook}</p>
        </div>
      `;
    }

    return html;
  }

  /**
   * 【v12.2】构建策略型输出卡（含可证伪预测）
   */
  buildStrategyPathCard(output) {
    // 决策链渲染
    let chainHtml = '—';
    if (output.decision_chain && output.decision_chain.length > 0) {
      chainHtml = output.decision_chain
        .map((item, i) => {
          const isLast = i === output.decision_chain.length - 1;
          return `<span class="mini-chain-node">${item}</span>${isLast ? '' : '<span class="mini-chain-arrow">→</span>'}`;
        })
        .join('');
    }

    let html = `
      <div class="card-field">
        <label>你要做的决策</label>
        <p>${output.decision || '—'}</p>
      </div>
      <div class="card-field">
        <label>你想要的结果</label>
        <p>${output.target_outcome || '—'}</p>
      </div>
      <div class="card-field">
        <label>决策链条</label>
        <div class="world-model-content">
          <div class="mini-causal-chain">${chainHtml}</div>
        </div>
      </div>
      <div class="card-field highlight">
        <label>最关键的承重环</label>
        <p>${output.weakest_link || '—'}</p>
      </div>
      <div class="card-field">
        <label>你默认、但没验证的假设</label>
        <p>${output.hidden_assumption || '—'}</p>
      </div>
      <div class="card-field highlight">
        <label>压力测试结果</label>
        <p>${output.pressure_test_result || '—'}</p>
      </div>
      <div class="card-field highlight">
        <label>接下来先验证的一步</label>
        <p>${output.next_step || '—'}</p>
      </div>
    `;

    // 【v12.2】可证伪预测
    html += this.buildPredictionSection(output.prediction);

    // 【v11】机会钩
    if (output.next_gap_hook) {
      html += `
        <div class="card-field next-gap-hook">
          <label>下一道缝（如果你想）</label>
          <p class="pull-style">${output.next_gap_hook}</p>
        </div>
      `;
    }

    return html;
  }

  /**
   * 【v12.2】构建可证伪预测栏
   */
  buildPredictionSection(prediction) {
    if (!prediction) {
      return '';
    }

    const placeholder = '<span class="prediction-placeholder">待你填</span>';

    return `
      <div class="card-section prediction-section">
        <h3>你的预测（可验证）</h3>
        <div class="prediction-grid">
          <div class="prediction-field">
            <label>预测指标</label>
            <p>${prediction.object || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>如果不改</label>
            <p>${prediction.if_unchanged || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>如果改变</label>
            <p>${prediction.if_changed || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>价值/代价</label>
            <p>${prediction.stake || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>验证时间</label>
            <p>${prediction.verify_window || placeholder}</p>
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

    let html = `
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

    // 【v12.2】可证伪预测（仅 actionable，no_experiment=true 说明是 retrospective）
    if (output.prediction && !output.no_experiment) {
      html += this.buildPredictionSection(output.prediction);
    }

    // 【v11】机会钩（仅当有值时显示）
    if (output.next_gap_hook) {
      html += `
        <div class="card-field next-gap-hook">
          <label>下一道缝（如果你想）</label>
          <p class="pull-style">${output.next_gap_hook}</p>
        </div>
      `;
    }

    return html;
  }

  hideDiscoveryCard() {
    this.discoveryCard.style.display = 'none';
    const overlay = document.getElementById('cardOverlay');
    if (overlay) {
      overlay.remove();
    }
  }

  /**
   * 生成 Markdown 格式报告
   */
  generateReportMarkdown(output, path) {
    const date = new Date().toLocaleDateString('zh-CN');
    let markdown = '';

    if (path === 'strategy') {
      // 【v12】策略型报告
      const decisionChain = output.decision_chain?.join(' → ') || '—';
      markdown = `# 决策报告

> 生成日期：${date}

## 你要做的决策

${output.decision || '—'}

## 决策链条

${decisionChain}

## 最不确定的一环

${output.weakest_link || '—'}

## 你默认、但没验证的假设

${output.hidden_assumption || '—'}

## 接下来先做的一步

${output.next_step || '—'}

${output.next_gap_hook ? `---

## 下一道缝（如果你想）

${output.next_gap_hook}` : ''}
`;
    } else if (path === 'early') {
      markdown = `# 验证计划报告

> 生成日期：${date}

## 当前想法/挑战

${output.current_idea || output.current_problem || '—'}

## 核心假设

${output.core_assumption || '—'}

## 被撬动的假设

${output.challenged_assumption || '—'}

## 你的预测

${output.prediction || '—'}

## 验证成功定义

${output.success_definition || '—'}

## 更新后的问题定义

${output.redefined_problem || '—'}

---

## 7天验证实验

| 项目 | 内容 |
|------|------|
| **最小验证** | ${output.seven_day_experiment?.experiment || '—'} |
| **成功标准** | ${output.seven_day_experiment?.success_criteria || '—'} |
| **时间** | ${output.seven_day_experiment?.time_horizon || '7天'} |
| **负责人** | ${output.seven_day_experiment?.owner || '你'} |
`;
    } else {
      // org 路径
      const causalChain = output.world_model?.causal_chain?.join(' → ') || '—';
      const hiddenAssumptions = output.world_model?.hidden_assumptions?.join('；') || '—';
      const missingVariables = output.missing_variables?.join('、') || '—';
      const curiosityQuestions = output.curiosity_questions?.join('；') || '—';

      markdown = `# 发现报告

> 生成日期：${date}

## 当前问题定义

${output.current_problem || '—'}

## 当前世界模型（因果链）

${causalChain}

## 隐藏假设

${hiddenAssumptions}

## 可能缺失的变量

${missingVariables}

## 好奇问题

${curiosityQuestions}

## 更新后的问题定义

${output.redefined_problem || '—'}

---

## 7天实验

| 项目 | 内容 |
|------|------|
| **假设** | ${output.seven_day_experiment?.hypothesis || '—'} |
| **实验** | ${output.seven_day_experiment?.experiment || '—'} |
| **成功标准** | ${output.seven_day_experiment?.success_criteria || '—'} |
| **时间** | ${output.seven_day_experiment?.time_horizon || '—'} |
| **负责人** | ${output.seven_day_experiment?.owner || '—'} |
`;
    }

    return markdown;
  }

  /**
   * 下载报告
   */
  downloadReport() {
    if (!this.lastDiscoveryOutput) {
      alert('没有可下载的报告');
      return;
    }

    const markdown = this.generateReportMarkdown(this.lastDiscoveryOutput, this.lastPath);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    // 【v12】添加 strategy 路径文件名
    let filename = '发现报告.md';
    if (this.lastPath === 'early') {
      filename = '验证计划报告.md';
    } else if (this.lastPath === 'strategy') {
      filename = '决策报告.md';
    }
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  restart() {
    // 重置状态
    this.history = [];
    this.sessionId = null;
    this.sessionComplete = false;
    this.pendingOptions = null;
    this.currentDifficulty = 'L1';
    this.currentPath = 'unknown';
    this.lastDiscoveryOutput = null;
    this.lastPath = null;

    // 【v9】退出回看模式
    this.isReplayMode = false;
    this.viewingSessionId = null;
    this.appContainer.classList.remove('replay-mode');
    this.hideReplayBanner();

    // 重置UI
    this.chatMessages.innerHTML = '';
    this.appContainer.classList.remove('has-messages'); // 恢复欢迎界面
    this.inputContainer.classList.remove('hidden');
    this.inputContainer.style.display = 'block';
    this.hideDiscoveryCard();
    this.hideChoiceOptions();
    this.updateSessionHint(null);

    // 【v9】更新侧边栏
    this.renderSessionList();

    // 不自动获取开场白，等待用户输入
  }

  // 【v9】发送消息前检查回看模式
  async sendMessage() {
    // 在回看模式下不允许发送
    if (this.isReplayMode) {
      return;
    }

    const text = this.userInput.value.trim();
    const hasImage = !!this.pendingImage;

    // 至少需要文字或图片
    if ((!text && !hasImage) || this.isLoading) return;

    // 构建消息内容
    const content = hasImage
      ? this.buildMessageContent(text, this.pendingImage.base64)
      : text;

    // 添加用户消息（显示时需要特殊处理）
    this.addMessage(content, 'user', false, hasImage);
    this.history.push({ role: 'user', content });

    // 清空输入框和图片
    this.userInput.value = '';
    this.clearPendingImage();
    this.autoResize();
    this.updateSendButton();

    // 获取AI响应
    await this.getAIResponse();
  }

  // 【v9】更新发送按钮状态（支持图片）
  updateSendButton() {
    const hasText = this.userInput.value.trim().length > 0;
    const hasImage = !!this.pendingImage;
    this.sendBtn.disabled = (!hasText && !hasImage) || this.isLoading;
  }
}

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new OrganizationalMirror();
});
