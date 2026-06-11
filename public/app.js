/**
 * 组织镜子 - 前端逻辑 (v12 策略型分流 + v10 双语)
 *
 * v10 新增（2026-06-10）：
 * - 中英双语支持（照见 / Hindsight）
 * - 界面语言随时切换（侧边栏语言按钮）
 * - 对话语言开场定、整场固定（首次进入弹窗选择）
 * - i18n.js 字典 + t(key) 翻译函数
 * - 所有 UI 文本、发现卡标签、报告下载均已本地化
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

    // 【v10】语言状态
    this.conversationLang = null;  // 对话语言（开场定，整场固定）

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

    // 【v10】语言相关元素
    this.langModalOverlay = document.getElementById('langModalOverlay');
    this.langToggleBtn = document.getElementById('langToggleBtn');

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

    // 【v10】语言选择按钮
    document.querySelectorAll('.lang-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        this.selectLanguage(lang);
      });
    });

    // 【v10】语言切换按钮（界面语言）
    this.langToggleBtn?.addEventListener('click', () => {
      this.toggleUILanguage();
    });
  }

  async init() {
    // 【v10】检查是否已选择语言
    const savedLang = localStorage.getItem('mirror_conversation_lang');

    if (savedLang) {
      // 已有语言设置，使用保存的语言
      this.conversationLang = savedLang;
      setUILang(savedLang);
      setConversationLang(savedLang);
      this.updateAllUIText();
      this.checkUserAndProceed();
    } else {
      // 首次进入，显示语言选择
      this.showLangModal();
    }
  }

  // 【v10】显示语言选择弹窗
  showLangModal() {
    this.langModalOverlay.style.display = 'flex';
  }

  // 【v10】隐藏语言选择弹窗
  hideLangModal() {
    this.langModalOverlay.style.display = 'none';
  }

  // 【v10】选择语言（开场）
  selectLanguage(lang) {
    this.conversationLang = lang;
    setUILang(lang);
    setConversationLang(lang);

    // 保存到本地存储
    localStorage.setItem('mirror_conversation_lang', lang);

    this.hideLangModal();
    this.updateAllUIText();
    this.checkUserAndProceed();
  }

  // 【v10】切换界面语言
  toggleUILanguage() {
    const currentLang = getUILang();
    const newLang = currentLang === 'zh' ? 'en' : 'zh';
    setUILang(newLang);
    this.updateAllUIText();
  }

  // 【v10】更新所有界面文本
  updateAllUIText() {
    // 页面标题
    document.getElementById('pageTitle').textContent = t('app_title');

    // 侧边栏
    document.getElementById('sidebarLogo').textContent = t('app_title');
    this.newChatBtn.textContent = t('sidebar_new');
    this.langToggleBtn.textContent = t('lang_toggle');

    // 欢迎区域
    document.getElementById('welcomeLogo').textContent = t('app_title');
    document.getElementById('welcomeTagline').textContent = t('app_subtitle');

    // 姓名弹窗
    document.getElementById('welcomeTitle').textContent = t('welcome_title');
    document.getElementById('welcomeHint').textContent = t('welcome_hint');
    this.nameInput.placeholder = t('name_placeholder');
    this.companyInput.placeholder = t('company_placeholder');
    this.nameSubmitBtn.textContent = t('btn_start');

    // 输入区
    this.userInput.placeholder = t('input_placeholder');
    document.getElementById('inputHint').textContent = t('input_hint');
    this.endSessionBtn.textContent = t('btn_end');
    this.otherInput.placeholder = t('other_placeholder');
    this.otherSubmit.textContent = t('btn_submit');

    // 加载状态
    document.getElementById('loadingText').textContent = t('thinking');

    // 发现卡按钮
    document.getElementById('downloadCard').textContent = t('btn_download');
    document.getElementById('restartBtn').textContent = t('btn_restart');

    // 侧边栏会话列表
    this.renderSessionList();
  }

  // 【v10】检查用户并继续
  checkUserAndProceed() {
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
    this.nameSubmitBtn.textContent = t('loading');

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, company })
      });

      const data = await response.json();

      if (data.error) {
        alert(t('error_create_user') + data.error);
        this.nameSubmitBtn.disabled = false;
        this.nameSubmitBtn.textContent = t('btn_start');
        return;
      }

      this.currentUser = data.user;
      localStorage.setItem('mirror_user', JSON.stringify(this.currentUser));

      this.hideNameModal();
      this.onUserReady();

    } catch (error) {
      console.error('Error creating user:', error);
      alert(t('error_network'));
      this.nameSubmitBtn.disabled = false;
      this.nameSubmitBtn.textContent = t('btn_start');
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
      this.sidebarSessions.innerHTML = `<div class="sidebar-empty">${t('sidebar_empty')}</div>`;
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
      <p>${t('replay_hint')}</p>
      <button class="btn-primary" id="replayNewChatBtn">${t('btn_new_chat')}</button>
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
      alert(t('error_image_type'));
      return;
    }

    // 检查文件大小（5MB）
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      alert(t('error_image_size'));
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
      'approaching_end': t('hint_approaching_end'),
      'last_question': t('hint_last_question')
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
          endRequested: endRequested, // 【v8】用户请求结束
          conversationLang: this.conversationLang // 【v10】对话语言
        })
      });

      const data = await response.json();

      this.hideLoading();

      if (data.error) {
        this.addMessage(t('error_system'), 'ai');
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
      this.addMessage(t('error_network'), 'ai');
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
   * 【v17】优先显示叙事报告
   */
  showDiscoveryCard(output, path) {
    // 保存报告数据供下载使用
    this.lastDiscoveryOutput = output;
    this.lastPath = path;

    const cardContent = document.getElementById('cardContent');
    const cardTitle = document.getElementById('cardTitle');

    // 【v17】如果有叙事报告，优先显示
    if (output.narrative_report) {
      cardTitle.textContent = t('card_title_letter') || '照见信';
      cardContent.innerHTML = this.buildNarrativeReportCard(output);
    } else if (path === 'early') {
      // 早期路径输出卡
      cardTitle.textContent = t('card_title_plan');
      cardContent.innerHTML = this.buildEarlyPathCard(output);
    } else if (path === 'strategy') {
      // 【v12】策略型输出卡
      cardTitle.textContent = t('card_title_decision');
      cardContent.innerHTML = this.buildStrategyPathCard(output);
    } else {
      // 组织路径输出卡
      cardTitle.textContent = t('card_title_discovery');
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
   * 【v17】构建叙事报告卡（照见信）
   */
  buildNarrativeReportCard(output) {
    // 将 markdown 格式的文本转换为 HTML（简单处理）
    const formatNarrative = (text) => {
      if (!text) return '';
      // 保留换行
      return text
        .split('\n\n')
        .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
        .join('');
    };

    let html = `
      <div class="narrative-report">
        <div class="narrative-content">
          ${formatNarrative(output.narrative_report)}
        </div>
      </div>
    `;

    // 【v11】机会钩（如果有）
    if (output.next_gap_hook) {
      html += `
        <div class="card-field next-gap-hook">
          <label>${t('field_next_gap') || '下一道缝'}</label>
          <p class="pull-style">${output.next_gap_hook}</p>
        </div>
      `;
    }

    return html;
  }

  /**
   * 构建早期路径输出卡
   */
  buildEarlyPathCard(output) {
    const nc = t('not_covered');
    let html = `
      <div class="card-field">
        <label>${t('field_current_idea')}</label>
        <p>${output.current_idea || output.current_problem || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_core_assumption')}</label>
        <p>${output.core_assumption || nc}</p>
      </div>
      <div class="card-field highlight">
        <label>${t('field_challenged_assumption')}</label>
        <p>${output.challenged_assumption || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_prediction')}</label>
        <p>${output.prediction || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_success_definition')}</label>
        <p>${output.success_definition || nc}</p>
      </div>
      <div class="card-field highlight">
        <label>${t('field_redefined_problem')}</label>
        <p>${output.redefined_problem || nc}</p>
      </div>
      <div class="card-section experiment-section">
        <h3>${t('field_validation_title')}</h3>
        <div class="card-field">
          <label>${t('field_min_validation')}</label>
          <p>${output.seven_day_experiment?.experiment || nc}</p>
        </div>
        <div class="card-field">
          <label>${t('field_success_criteria')}</label>
          <p>${output.seven_day_experiment?.success_criteria || nc}</p>
        </div>
        <div class="card-row">
          <div class="card-field half">
            <label>${t('field_time')}</label>
            <p>${output.seven_day_experiment?.time_horizon || t('default_time')}</p>
          </div>
          <div class="card-field half">
            <label>${t('field_owner')}</label>
            <p>${output.seven_day_experiment?.owner || t('default_owner')}</p>
          </div>
        </div>
      </div>
    `;

    // 【v11】机会钩（仅当有值时显示）
    if (output.next_gap_hook) {
      html += `
        <div class="card-field next-gap-hook">
          <label>${t('field_next_gap')}</label>
          <p class="pull-style">${output.next_gap_hook}</p>
        </div>
      `;
    }

    return html;
  }

  /**
   * 【v15】构建策略型输出卡（世界规则版）
   */
  buildStrategyPathCard(output) {
    const nc = t('not_covered');

    // 决策链渲染
    let chainHtml = nc;
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
        <label>${t('field_decision')}</label>
        <p>${output.decision || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_target_outcome')}</label>
        <p>${output.target_outcome || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_decision_chain')}</label>
        <div class="world-model-content">
          <div class="mini-causal-chain">${chainHtml}</div>
        </div>
      </div>
      <div class="card-field highlight">
        <label>${t('field_weakest_link')}</label>
        <p>${output.weakest_link || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_hidden_assumption')}</label>
        <p>${output.hidden_assumption || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_assumption_source')}</label>
        <p>${output.assumption_source || nc}</p>
      </div>
      <div class="card-field highlight world-rule">
        <label>${t('field_world_rule')}</label>
        <p>${output.world_rule || nc}</p>
      </div>
      <div class="card-field highlight">
        <label>${t('field_next_step')}</label>
        <p>${output.next_step || nc}</p>
      </div>
    `;

    // 【v11】机会钩
    if (output.next_gap_hook) {
      html += `
        <div class="card-field next-gap-hook">
          <label>${t('field_next_gap')}</label>
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

    const placeholder = `<span class="prediction-placeholder">${t('placeholder_fill')}</span>`;

    return `
      <div class="card-section prediction-section">
        <h3>${t('field_prediction_title')}</h3>
        <div class="prediction-grid">
          <div class="prediction-field">
            <label>${t('field_prediction_object')}</label>
            <p>${prediction.object || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>${t('field_if_unchanged')}</label>
            <p>${prediction.if_unchanged || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>${t('field_if_changed')}</label>
            <p>${prediction.if_changed || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>${t('field_stake')}</label>
            <p>${prediction.stake || placeholder}</p>
          </div>
          <div class="prediction-field">
            <label>${t('field_verify_window')}</label>
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
    const nc = t('not_covered');

    // 【v16.2 兼容修复】同时支持平级和嵌套格式
    // 因果链：优先取 causal_chain（新格式），回退到 world_model.causal_chain（旧格式）
    const causalChain = output.causal_chain || output.world_model?.causal_chain || [];
    // 隐藏假设：优先取 wrong_assumptions（新格式），回退到 hidden_assumptions / world_model.hidden_assumptions
    const hiddenAssumptions = output.wrong_assumptions || output.hidden_assumptions || output.world_model?.hidden_assumptions || [];

    // 因果链渲染
    let causalChainHtml = nc;
    const validChain = causalChain.filter(item => item && item !== null);
    if (validChain.length > 0) {
      causalChainHtml = validChain
        .map((item, i) => {
          const isLast = i === validChain.length - 1;
          return `<span class="mini-chain-node">${item}</span>${isLast ? '' : '<span class="mini-chain-arrow">→</span>'}`;
        })
        .join('');
    }

    // 隐藏假设渲染
    const validAssumptions = hiddenAssumptions.filter(item => item && item !== null);
    const assumptionsHtml = validAssumptions.length > 0 ? validAssumptions.join('；') : nc;

    let html = `
      <div class="card-field">
        <label>${t('field_current_problem')}</label>
        <p>${output.current_problem || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_causal_chain')}</label>
        <div class="world-model-content">
          <div class="mini-causal-chain">${causalChainHtml}</div>
        </div>
      </div>
      <div class="card-field">
        <label>${t('field_hidden_assumptions')}</label>
        <p>${assumptionsHtml}</p>
      </div>
    `;

    // 【v16.2】世界规则（如果有，高亮显示）
    if (output.world_rule && output.world_rule.trim()) {
      html += `
        <div class="card-field highlight world-rule">
          <label>${t('field_world_rule') || '底层规则'}</label>
          <p>${output.world_rule}</p>
        </div>
      `;
    }

    html += `
      <div class="card-field highlight">
        <label>${t('field_missing_variables')}</label>
        <p>${output.missing_variables?.join('、') || nc}</p>
      </div>
      <div class="card-field">
        <label>${t('field_curiosity_questions')}</label>
        <p>${output.curiosity_questions?.join('；') || nc}</p>
      </div>
      <div class="card-field highlight">
        <label>${t('field_redefined_problem')}</label>
        <p>${output.redefined_problem || nc}</p>
      </div>
    `;

    // 实验卡（仅非 retrospective）
    if (!output.no_experiment) {
      html += `
        <div class="card-section experiment-section">
          <h3>${t('field_experiment_title')}</h3>
          <div class="card-field">
            <label>${t('field_hypothesis')}</label>
            <p>${output.seven_day_experiment?.hypothesis || nc}</p>
          </div>
          <div class="card-field">
            <label>${t('field_experiment')}</label>
            <p>${output.seven_day_experiment?.experiment || nc}</p>
          </div>
          <div class="card-field">
            <label>${t('field_success_criteria')}</label>
            <p>${output.seven_day_experiment?.success_criteria || nc}</p>
          </div>
          <div class="card-row">
            <div class="card-field half">
              <label>${t('field_time')}</label>
              <p>${output.seven_day_experiment?.time_horizon || t('default_time')}</p>
            </div>
            <div class="card-field half">
              <label>${t('field_owner')}</label>
              <p>${output.seven_day_experiment?.owner || t('default_owner')}</p>
            </div>
          </div>
        </div>
      `;
    }

    // 【v12.2】可证伪预测（仅 actionable，no_experiment=true 说明是 retrospective）
    if (output.prediction && !output.no_experiment) {
      html += this.buildPredictionSection(output.prediction);
    }

    // 【v11】机会钩（仅当有值时显示）
    if (output.next_gap_hook) {
      html += `
        <div class="card-field next-gap-hook">
          <label>${t('field_next_gap')}</label>
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
    const lang = getUILang();
    const dateLocale = lang === 'zh' ? 'zh-CN' : 'en-US';
    const date = new Date().toLocaleDateString(dateLocale);
    const nc = t('not_covered');
    let markdown = '';

    if (path === 'strategy') {
      // 【v12】策略型报告
      const decisionChain = output.decision_chain?.join(' → ') || nc;
      const title = lang === 'zh' ? '决策报告' : 'Decision Report';
      const genDate = lang === 'zh' ? '生成日期' : 'Generated';

      markdown = `# ${title}

> ${genDate}：${date}

## ${t('field_decision')}

${output.decision || nc}

## ${t('field_decision_chain')}

${decisionChain}

## ${t('field_weakest_link')}

${output.weakest_link || nc}

## ${t('field_hidden_assumption')}

${output.hidden_assumption || nc}

## ${t('field_next_step')}

${output.next_step || nc}

${output.next_gap_hook ? `---

## ${t('field_next_gap')}

${output.next_gap_hook}` : ''}
`;
    } else if (path === 'early') {
      const title = lang === 'zh' ? '验证计划报告' : 'Validation Plan Report';
      const genDate = lang === 'zh' ? '生成日期' : 'Generated';

      markdown = `# ${title}

> ${genDate}：${date}

## ${t('field_current_idea')}

${output.current_idea || output.current_problem || nc}

## ${t('field_core_assumption')}

${output.core_assumption || nc}

## ${t('field_challenged_assumption')}

${output.challenged_assumption || nc}

## ${t('field_prediction')}

${output.prediction || nc}

## ${t('field_success_definition')}

${output.success_definition || nc}

## ${t('field_redefined_problem')}

${output.redefined_problem || nc}

---

## ${t('field_validation_title')}

| ${lang === 'zh' ? '项目' : 'Field'} | ${lang === 'zh' ? '内容' : 'Content'} |
|------|------|
| **${t('field_min_validation')}** | ${output.seven_day_experiment?.experiment || nc} |
| **${t('field_success_criteria')}** | ${output.seven_day_experiment?.success_criteria || nc} |
| **${t('field_time')}** | ${output.seven_day_experiment?.time_horizon || t('default_time')} |
| **${t('field_owner')}** | ${output.seven_day_experiment?.owner || t('default_owner')} |
`;
    } else {
      // org 路径
      const causalChain = output.world_model?.causal_chain?.join(' → ') || nc;
      const hiddenAssumptions = output.world_model?.hidden_assumptions?.join('；') || nc;
      const missingVariables = output.missing_variables?.join('、') || nc;
      const curiosityQuestions = output.curiosity_questions?.join('；') || nc;
      const title = lang === 'zh' ? '发现报告' : 'Discovery Report';
      const genDate = lang === 'zh' ? '生成日期' : 'Generated';

      markdown = `# ${title}

> ${genDate}：${date}

## ${t('field_current_problem')}

${output.current_problem || nc}

## ${t('field_causal_chain')}

${causalChain}

## ${t('field_hidden_assumptions')}

${hiddenAssumptions}

## ${t('field_missing_variables')}

${missingVariables}

## ${t('field_curiosity_questions')}

${curiosityQuestions}

## ${t('field_redefined_problem')}

${output.redefined_problem || nc}

---

## ${t('field_experiment_title')}

| ${lang === 'zh' ? '项目' : 'Field'} | ${lang === 'zh' ? '内容' : 'Content'} |
|------|------|
| **${t('field_hypothesis')}** | ${output.seven_day_experiment?.hypothesis || nc} |
| **${t('field_experiment')}** | ${output.seven_day_experiment?.experiment || nc} |
| **${t('field_success_criteria')}** | ${output.seven_day_experiment?.success_criteria || nc} |
| **${t('field_time')}** | ${output.seven_day_experiment?.time_horizon || nc} |
| **${t('field_owner')}** | ${output.seven_day_experiment?.owner || nc} |
`;
    }

    return markdown;
  }

  /**
   * 【v18.3】生成 HTML 格式的照见信（手机/电脑通用）
   */
  generateReportHTML(output, path) {
    const lang = getUILang();
    const dateLocale = lang === 'zh' ? 'zh-CN' : 'en-US';
    const date = new Date().toLocaleDateString(dateLocale);

    // 标题
    let title;
    if (output.narrative_report) {
      title = lang === 'zh' ? '照见信' : 'Mirror Letter';
    } else if (path === 'early') {
      title = lang === 'zh' ? '验证计划' : 'Validation Plan';
    } else if (path === 'strategy') {
      title = lang === 'zh' ? '决策报告' : 'Decision Report';
    } else {
      title = lang === 'zh' ? '发现报告' : 'Discovery Report';
    }

    // 内容
    let content = '';

    if (output.narrative_report) {
      // 【v17+】照见信叙事格式
      content = output.narrative_report
        .split('\n\n')
        .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
        .join('\n      ');
    } else {
      // 结构化报告（回退）
      const nc = t('not_covered');
      if (path === 'strategy') {
        content = `
      <h2>${t('field_decision')}</h2>
      <p>${output.decision || nc}</p>

      <h2>${t('field_decision_chain')}</h2>
      <p>${output.decision_chain?.join(' → ') || nc}</p>

      <h2>${t('field_weakest_link')}</h2>
      <p>${output.weakest_link || nc}</p>

      <h2>${t('field_hidden_assumption')}</h2>
      <p>${output.hidden_assumption || nc}</p>

      <h2>${t('field_next_step')}</h2>
      <p>${output.next_step || nc}</p>`;
      } else if (path === 'early') {
        content = `
      <h2>${t('field_current_idea')}</h2>
      <p>${output.current_idea || output.current_problem || nc}</p>

      <h2>${t('field_core_assumption')}</h2>
      <p>${output.core_assumption || nc}</p>

      <h2>${t('field_challenged_assumption')}</h2>
      <p>${output.challenged_assumption || nc}</p>

      <h2>${t('field_prediction')}</h2>
      <p>${output.prediction || nc}</p>

      <h2>${t('field_success_definition')}</h2>
      <p>${output.success_definition || nc}</p>`;
      } else {
        content = `
      <h2>${t('field_current_problem')}</h2>
      <p>${output.current_problem || nc}</p>

      <h2>${t('field_causal_chain')}</h2>
      <p>${output.causal_chain?.join(' → ') || nc}</p>

      <h2>${t('field_world_rule')}</h2>
      <p>${output.world_rule || nc}</p>

      <h2>${t('field_redefined_problem')}</h2>
      <p>${output.redefined_problem || nc}</p>`;
      }
    }

    // 机会钩
    let hookSection = '';
    if (output.next_gap_hook) {
      const hookLabel = lang === 'zh' ? '下一道缝' : 'Next Gap';
      hookSection = `
    <div class="hook">
      <h3>${hookLabel}</h3>
      <p>${output.next_gap_hook}</p>
    </div>`;
    }

    // 完整 HTML（内联样式，确保手机兼容）
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.8;
      color: #333;
      background: #f9f9f9;
      padding: 20px;
      max-width: 100%;
    }
    .container {
      max-width: 680px;
      margin: 0 auto;
      background: #fff;
      padding: 32px 24px;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    h1 {
      font-size: 1.5em;
      color: #1a1a1a;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .date {
      font-size: 0.875em;
      color: #888;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #eee;
    }
    .content {
      font-size: 1em;
    }
    .content p {
      margin-bottom: 1.2em;
      text-align: justify;
    }
    .content h2 {
      font-size: 1.1em;
      color: #444;
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 500;
    }
    .hook {
      margin-top: 32px;
      padding: 16px;
      background: linear-gradient(135deg, #f8f4ff 0%, #fff5f5 100%);
      border-radius: 8px;
      border-left: 3px solid #9b59b6;
    }
    .hook h3 {
      font-size: 0.9em;
      color: #9b59b6;
      margin-bottom: 8px;
      font-weight: 500;
    }
    .hook p {
      font-size: 0.95em;
      color: #666;
      margin: 0;
    }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #eee;
      font-size: 0.8em;
      color: #aaa;
      text-align: center;
    }
    @media (max-width: 480px) {
      body {
        padding: 12px;
      }
      .container {
        padding: 24px 16px;
        border-radius: 8px;
      }
      h1 {
        font-size: 1.3em;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <div class="date">${date}</div>
    <div class="content">
      ${content}
    </div>
    ${hookSection}
    <div class="footer">
      ${lang === 'zh' ? '由照见生成' : 'Generated by Mirror'}
    </div>
  </div>
</body>
</html>`;

    return html;
  }

  /**
   * 下载报告（v18.3: 改为 HTML 格式）
   */
  downloadReport() {
    if (!this.lastDiscoveryOutput) {
      alert(t('error_no_report'));
      return;
    }

    const html = this.generateReportHTML(this.lastDiscoveryOutput, this.lastPath);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;

    // 文件名
    const lang = getUILang();
    let filename;
    if (this.lastDiscoveryOutput.narrative_report) {
      filename = lang === 'zh' ? '照见信.html' : 'mirror-letter.html';
    } else if (this.lastPath === 'early') {
      filename = lang === 'zh' ? '验证计划.html' : 'validation-plan.html';
    } else if (this.lastPath === 'strategy') {
      filename = lang === 'zh' ? '决策报告.html' : 'decision-report.html';
    } else {
      filename = lang === 'zh' ? '发现报告.html' : 'discovery-report.html';
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
