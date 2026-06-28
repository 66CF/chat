// ============================================================
// === Debug Mode — 调试模式 ===
// ============================================================
// 功能：API 请求/响应日志、性能计时、状态监控、对话历史查看

const Debug = {
  enabled: false,
  logs: [],           // { time, level, category, message, data }
  requests: [],       // { id, method, url, model, startTime, firstTokenTime, endTime, status, request, response, error }
  maxLogs: 500,
  maxRequests: 50,
  _reqCounter: 0,
  _panel: null,
  _activeTab: 'logs',
  _autoScroll: true,
  _paused: false,

  // --- Init ---
  init() {
    // Check localStorage for saved preference
    const saved = localStorage.getItem('vbc_debug_mode');
    if (saved === '1') this.enable();

    // Intercept console methods to capture all output
    this._interceptConsole();

    // Listen for keyboard shortcut: Ctrl+Shift+D
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.toggle();
      }
    });

    this.info('debug', '调试模块已加载 (Ctrl+Shift+D 切换)');
  },

  // --- Enable / Disable ---
  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },

  enable() {
    this.enabled = true;
    localStorage.setItem('vbc_debug_mode', '1');
    document.body.classList.add('debug-mode');
    this._updateBtn(true);
    this._showPanel();
    this.info('debug', '🐛 调试模式已开启');
    // Log current state
    this._logAppState();
  },

  disable() {
    this.enabled = false;
    localStorage.setItem('vbc_debug_mode', '0');
    document.body.classList.remove('debug-mode');
    this._updateBtn(false);
    this._hidePanel();
    // Return focus to chat input
    const chatInput = document.getElementById('chatInput');
    if (chatInput && !chatInput.disabled) chatInput.focus();
  },

  // --- Logging API ---
  info(category, message, data)    { this._log('info', category, message, data); },
  warn(category, message, data)    { this._log('warn', category, message, data); },
  error(category, message, data)   { this._log('error', category, message, data); },
  debug_log(category, message, data) { this._log('debug', category, message, data); },

  _log(level, category, message, data) {
    const entry = {
      time: Date.now(),
      level,
      category,
      message: typeof message === 'string' ? message : String(message),
      data: data !== undefined ? data : null
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);

    // Also call original console method
    const prefix = `[${category}]`;
    if (level === 'error') console.error(prefix, message, data || '');
    else if (level === 'warn') console.warn(prefix, message, data || '');
    else console.log(prefix, message, data || '');

    // Update panel if visible
    if (this.enabled && this._activeTab === 'logs') this._renderLogs();
  },

  // --- Request Tracking ---
  startRequest(method, url, body) {
    const id = ++this._reqCounter;
    const entry = {
      id,
      method,
      url: this._shortenUrl(url),
      model: body?.model || 'unknown',
      startTime: performance.now(),
      firstTokenTime: null,
      endTime: null,
      status: null,
      request: {
        model: body?.model,
        max_tokens: body?.max_tokens,
        stream: body?.stream,
        messageCount: body?.messages?.length,
        systemLength: body?.messages?.[0]?.role === 'system' ? (body?.messages?.[0]?.content?.length || 0) : 0,
        tools: body?.tools?.length || 0,
        // Store full request for debug (truncated)
        _fullBody: this._truncateForLog(body, 3000)
      },
      response: null,
      error: null,
      chunkCount: 0,
      totalChars: 0
    };
    this.requests.push(entry);
    if (this.requests.length > this.maxRequests) this.requests.splice(0, this.requests.length - this.maxRequests);

    this.info('api', `→ ${method} ${entry.url} [${entry.request.model}]`, {
      messages: entry.request.messageCount,
      max_tokens: entry.request.max_tokens,
      stream: entry.request.stream
    });

    if (this.enabled && this._activeTab === 'requests') this._renderRequests();
    return id;
  },

  recordFirstToken(reqId) {
    const req = this.requests.find(r => r.id === reqId);
    if (req && !req.firstTokenTime) {
      req.firstTokenTime = performance.now();
      const ttf = (req.firstTokenTime - req.startTime).toFixed(0);
      this.info('api', `← 首 token [${reqId}] ${ttf}ms`);
    }
  },

  recordChunk(reqId, chunkSize) {
    const req = this.requests.find(r => r.id === reqId);
    if (req) {
      req.chunkCount++;
      req.totalChars += chunkSize || 0;
    }
  },

  endRequest(reqId, status, responseText) {
    const req = this.requests.find(r => r.id === reqId);
    if (!req) return;
    req.endTime = performance.now();
    req.status = status;
    const totalMs = (req.endTime - req.startTime).toFixed(0);
    const ttf = req.firstTokenTime ? (req.firstTokenTime - req.startTime).toFixed(0) : '-';
    req.response = {
      status,
      totalMs: parseInt(totalMs),
      ttf: parseInt(ttf) || null,
      chunks: req.chunkCount,
      chars: req.totalChars,
      preview: (responseText || '').slice(0, 500)
    };

    if (status >= 200 && status < 300) {
      this.info('api', `✓ [${reqId}] ${status} 总耗时 ${totalMs}ms (TTF ${ttf}ms, ${req.chunkCount} chunks, ${req.totalChars} chars)`);
    } else {
      this.warn('api', `✗ [${reqId}] ${status} ${totalMs}ms`, responseText?.slice(0, 200));
    }

    if (this.enabled && this._activeTab === 'requests') this._renderRequests();
  },

  failRequest(reqId, error) {
    const req = this.requests.find(r => r.id === reqId);
    if (!req) return;
    req.endTime = performance.now();
    req.status = 'error';
    req.error = error?.message || String(error);
    const totalMs = (req.endTime - req.startTime).toFixed(0);
    this.error('api', `✗ [${reqId}] 错误 ${totalMs}ms: ${req.error}`);

    if (this.enabled && this._activeTab === 'requests') this._renderRequests();
  },

  // --- TTS Tracking ---
  logTTS(index, phase, detail) {
    if (phase === 'start') {
      this.info('tts', `🔊 TTS[${index}] 开始`);
    } else if (phase === 'done') {
      this.info('tts', `✓ TTS[${index}] 完成 ${detail || ''}`);
    } else if (phase === 'error') {
      this.warn('tts', `✗ TTS[${index}] 失败: ${detail}`);
    } else if (phase === 'skip') {
      this.debug_log('tts', `⏭ TTS[${index}] 跳过 (prefetch hit)`);
    }
  },

  // --- Memory / Recall Tracking ---
  logRecall(query, chunks, duration) {
    this.info('recall', `🧠 记忆召回 "${query.slice(0, 30)}..." → ${chunks}条 ${duration?.toFixed(0) || '?'}ms`);
  },

  // --- Parse Tracking ---
  logParse(phase, detail) {
    if (phase === 'success') {
      this.info('parse', `📋 解析成功: ${detail}`);
    } else if (phase === 'fallback') {
      this.warn('parse', `⚠ 解析回退: ${detail}`);
    } else if (phase === 'error') {
      this.error('parse', `✗ 解析失败: ${detail}`);
    }
  },

  // --- State Inspection ---
  _logAppState() {
    const state = {
      model: typeof chatModel !== 'undefined' ? chatModel : 'N/A',
      isBusy: typeof isBusy !== 'undefined' ? isBusy : 'N/A',
      proactive: typeof proactiveEnabled !== 'undefined' ? proactiveEnabled : 'N/A',
      webSearch: typeof webSearchEnabled !== 'undefined' ? webSearchEnabled : 'N/A',
      peek: typeof peekEnabled !== 'undefined' ? peekEnabled : 'N/A',
      memory: typeof memoryEnabled !== 'undefined' ? memoryEnabled : 'N/A',
      historyLength: typeof conversationHistory !== 'undefined' ? conversationHistory.length : 'N/A',
      displayLength: typeof chatMessages !== 'undefined' ? chatMessages.length : 'N/A',
      chunks: typeof ImprintMemory !== 'undefined' ? ImprintMemory.chunks.length : 'N/A',
      rpActive: typeof rpActive !== 'undefined' ? rpActive : 'N/A',
    };
    this.info('state', '📊 应用状态', state);
  },

  // --- UI ---
  _updateBtn(on) {
    const btn = document.getElementById('debugBtn');
    if (btn) {
      btn.textContent = on ? '🐛 调试:开' : '🐛 调试:关';
      btn.style.opacity = on ? '1' : '0.5';
    }
  },

  _showPanel() {
    if (this._panel) {
      this._panel.style.display = 'flex';
      this._renderActiveTab();
      return;
    }
    this._createPanel();
    this._renderActiveTab();
  },

  _hidePanel() {
    if (this._panel) this._panel.style.display = 'none';
  },

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'debugPanel';
    panel.className = 'debug-panel';
    panel.innerHTML = `
      <div class="debug-panel-header">
        <div class="debug-tabs">
          <button class="debug-tab active" data-tab="logs" onclick="Debug.switchTab('logs')">📋 日志</button>
          <button class="debug-tab" data-tab="requests" onclick="Debug.switchTab('requests')">🌐 请求</button>
          <button class="debug-tab" data-tab="state" onclick="Debug.switchTab('state')">📊 状态</button>
          <button class="debug-tab" data-tab="history" onclick="Debug.switchTab('history')">💬 历史</button>
        </div>
        <div class="debug-panel-actions">
          <label class="debug-auto-scroll">
            <input type="checkbox" id="debugAutoScroll" checked onchange="Debug._autoScroll=this.checked" />
            自动滚动
          </label>
          <button class="debug-btn-sm" onclick="Debug.clearCurrentTab()">清空</button>
          <button class="debug-btn-sm" onclick="Debug.exportLogs()">导出</button>
          <button class="debug-panel-close" onclick="Debug.toggle()">✕</button>
        </div>
      </div>
      <div class="debug-panel-body" id="debugPanelBody"></div>
      <div class="debug-panel-footer">
        <span id="debugStatusBar">日志: ${this.logs.length} | 请求: ${this.requests.length}</span>
        <span class="debug-hint">Ctrl+Shift+D 切换 | 点击条目查看详情</span>
      </div>
    `;
    document.body.appendChild(panel);
    this._panel = panel;
  },

  switchTab(tab) {
    this._activeTab = tab;
    // Update tab buttons
    this._panel.querySelectorAll('.debug-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    this._renderActiveTab();
  },

  _renderActiveTab() {
    switch (this._activeTab) {
      case 'logs': this._renderLogs(); break;
      case 'requests': this._renderRequests(); break;
      case 'state': this._renderState(); break;
      case 'history': this._renderHistory(); break;
    }
  },

  _renderLogs() {
    const body = document.getElementById('debugPanelBody');
    if (!body) return;
    const filter = this._logFilter || '';
    let filtered = this.logs;
    if (filter) {
      const f = filter.toLowerCase();
      filtered = this.logs.filter(l =>
        l.category.toLowerCase().includes(f) ||
        l.message.toLowerCase().includes(f)
      );
    }
    const html = filtered.map(l => {
      const time = new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const ms = String(new Date(l.time).getMilliseconds()).padStart(3, '0');
      const levelClass = l.level;
      const dataStr = l.data ? `\n${this._formatData(l.data)}` : '';
      return `<div class="debug-log-entry ${levelClass}" onclick="Debug._toggleDetail(this)">` +
        `<span class="debug-log-time">${time}.${ms}</span>` +
        `<span class="debug-log-level">${l.level.toUpperCase()}</span>` +
        `<span class="debug-log-cat">[${l.category}]</span>` +
        `<span class="debug-log-msg">${this._escapeHtml(l.message)}</span>` +
        (l.data ? `<div class="debug-log-detail" style="display:none">${this._escapeHtml(dataStr)}</div>` : '') +
        `</div>`;
    }).join('');

    body.innerHTML = `<div class="debug-log-filter-row">
      <input type="text" class="debug-filter-input" placeholder="过滤日志..." value="${this._escapeHtml(filter)}" oninput="Debug._logFilter=this.value;Debug._renderLogs()" />
      <span class="debug-log-count">${filtered.length} / ${this.logs.length}</span>
    </div><div class="debug-log-list">${html}</div>`;

    if (this._autoScroll) {
      const list = body.querySelector('.debug-log-list');
      if (list) list.scrollTop = list.scrollHeight;
    }
    this._updateStatusBar();
  },

  _renderRequests() {
    const body = document.getElementById('debugPanelBody');
    if (!body) return;
    const html = this.requests.slice().reverse().map(r => {
      const duration = r.endTime ? (r.endTime - r.startTime).toFixed(0) : '...';
      const ttf = r.firstTokenTime ? (r.firstTokenTime - r.startTime).toFixed(0) : '-';
      const statusClass = r.status === 'error' ? 'error' : (r.status >= 200 && r.status < 300 ? 'success' : 'pending');
      const statusText = r.status === 'error' ? 'ERROR' : (r.status || 'pending');

      return `<div class="debug-req-entry ${statusClass}" onclick="Debug._toggleDetail(this)">` +
        `<div class="debug-req-header">` +
          `<span class="debug-req-id">#${r.id}</span>` +
          `<span class="debug-req-model">${this._escapeHtml(r.model)}</span>` +
          `<span class="debug-req-status ${statusClass}">${statusText}</span>` +
          `<span class="debug-req-timing">TTF: ${ttf}ms | 总: ${duration}ms</span>` +
          `<span class="debug-req-chunks">${r.chunkCount} chunks, ${r.totalChars} chars</span>` +
        `</div>` +
        `<div class="debug-req-detail" style="display:none">` +
          `<div class="debug-req-section"><b>请求:</b> ${r.request.messageCount}条消息, max_tokens=${r.request.max_tokens}, stream=${r.request.stream}, system=${r.request.systemLength}字, tools=${r.request.tools}</div>` +
          (r.request._fullBody ? `<div class="debug-req-section"><b>完整请求体:</b>\n${this._escapeHtml(this._safeStringify(r.request._fullBody, 2000))}</div>` : '') +
          (r.response ? `<div class="debug-req-section"><b>响应预览:</b>\n${this._escapeHtml(r.response.preview || '(empty)')}</div>` : '') +
          (r.error ? `<div class="debug-req-section error"><b>错误:</b> ${this._escapeHtml(r.error)}</div>` : '') +
        `</div>` +
        `</div>`;
    }).join('');

    body.innerHTML = `<div class="debug-req-list">${html || '<div class="debug-empty">暂无请求记录</div>'}</div>`;
    this._updateStatusBar();
  },

  _renderState() {
    const body = document.getElementById('debugPanelBody');
    if (!body) return;

    const getState = (key, fallback) => {
      try { return typeof eval(key) !== 'undefined' ? eval(key) : fallback; } catch(e) { return fallback; }
    };

    const states = [
      { label: '🤖 模型', value: getState('chatModel', 'N/A') },
      { label: '⏳ 忙碌', value: getState('isBusy', 'N/A') },
      { label: '💬 主动消息', value: getState('proactiveEnabled', 'N/A') },
      { label: '🔍 联网搜索', value: getState('webSearchEnabled', 'N/A') },
      { label: '👀 视监', value: getState('peekEnabled', 'N/A') },
      { label: '📁 记忆库', value: getState('memoryEnabled', 'N/A') },
      { label: '🎭 角色扮演', value: getState('rpActive', 'N/A') },
      { label: '🔄 批量模式', value: getState('batchMode', 'N/A') },
      { label: '💬 对话历史', value: `${getState('conversationHistory', []).length} 条` },
      { label: '📋 显示消息', value: `${getState('chatMessages', []).length} 条` },
      { label: '🧠 记忆块', value: `${typeof ImprintMemory !== 'undefined' ? ImprintMemory.chunks.length : 'N/A'} 个` },
      { label: '📐 渲染起点', value: `第 ${getState('chatRenderStart', 0)} 条` },
      { label: '🔊 当前音频', value: getState('currentAudio', null) ? '播放中' : '无' },
      { label: '🖼️ 待发图片', value: getState('pendingImage', null) ? '有' : '无' },
      { label: '📎 待发文件', value: getState('pendingFile', null) ? '有' : '无' },
      { label: '↩️ 引用回复', value: getState('pendingReply', null) ? '有' : '无' },
    ];

    const metrics = this._getMetrics();

    const html = `
      <div class="debug-state-section">
        <h3>📊 应用状态</h3>
        <table class="debug-state-table">
          ${states.map(s => `<tr><td class="debug-state-label">${s.label}</td><td class="debug-state-value">${typeof s.value === 'boolean' ? (s.value ? '✅ 是' : '❌ 否') : s.value}</td></tr>`).join('')}
        </table>
      </div>
      <div class="debug-state-section">
        <h3>⚡ 性能指标</h3>
        <table class="debug-state-table">
          <tr><td class="debug-state-label">总请求数</td><td>${metrics.totalRequests}</td></tr>
          <tr><td class="debug-state-label">成功请求</td><td>${metrics.successRequests}</td></tr>
          <tr><td class="debug-state-label">失败请求</td><td>${metrics.failedRequests}</td></tr>
          <tr><td class="debug-state-label">平均 TTF</td><td>${metrics.avgTTF}ms</td></tr>
          <tr><td class="debug-state-label">平均总耗时</td><td>${metrics.avgDuration}ms</td></tr>
          <tr><td class="debug-state-label">总 Token 估算</td><td>${metrics.totalChars} chars</td></tr>
        </table>
      </div>
      <div class="debug-state-section">
        <h3>🗄️ 存储</h3>
        <table class="debug-state-table">
          <tr><td class="debug-state-label">日志条数</td><td>${this.logs.length}</td></tr>
          <tr><td class="debug-state-label">请求记录</td><td>${this.requests.length}</td></tr>
          <tr><td class="debug-state-label">API Key</td><td>${mimoApiKey ? '已设置 (' + mimoApiKey.slice(0, 8) + '...)' : '未设置'}</td></tr>
          <tr><td class="debug-state-label">Google Key</td><td>${googleApiKey ? '已设置 (' + googleApiKey.slice(0, 8) + '...)' : '未设置'}</td></tr>
        </table>
      </div>
      <div class="debug-state-section">
        <h3>🌍 环境</h3>
        <table class="debug-state-table">
          <tr><td class="debug-state-label">User Agent</td><td class="debug-state-long">${this._escapeHtml(navigator.userAgent)}</td></tr>
          <tr><td class="debug-state-label">屏幕</td><td>${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x</td></tr>
          <tr><td class="debug-state-label">语言</td><td>${navigator.language}</td></tr>
          <tr><td class="debug-state-label">在线</td><td>${navigator.onLine ? '✅' : '❌'}</td></tr>
          <tr><td class="debug-state-label">通知权限</td><td>${typeof Notification !== 'undefined' ? Notification.permission : 'N/A'}</td></tr>
        </table>
      </div>
      <div style="padding:12px">
        <button class="debug-btn-sm" onclick="Debug._logAppState();showToast('状态已刷新')">🔄 刷新状态</button>
      </div>
    `;
    body.innerHTML = html;
    this._updateStatusBar();
  },

  _renderHistory() {
    const body = document.getElementById('debugPanelBody');
    if (!body) return;

    const hist = typeof conversationHistory !== 'undefined' ? conversationHistory : [];
    const display = typeof chatMessages !== 'undefined' ? chatMessages : [];

    let html = `<div class="debug-history-section">
      <h3>📡 API 对话历史 (${hist.length} 条)</h3>
      <div class="debug-history-list">`;

    hist.forEach((m, i) => {
      const role = m.role;
      let content = m.content || '';
      if (typeof content !== 'string') {
        content = this._safeStringify(content, 200);
      } else {
        content = content.slice(0, 300);
      }
      const roleClass = role === 'user' ? 'user' : (role === 'assistant' ? 'assistant' : 'system');
      html += `<div class="debug-history-entry ${roleClass}" onclick="Debug._toggleDetail(this)">
        <span class="debug-history-idx">#${i}</span>
        <span class="debug-history-role ${roleClass}">${role}</span>
        <span class="debug-history-preview">${this._escapeHtml(content.slice(0, 80))}${content.length > 80 ? '...' : ''}</span>
        <div class="debug-history-detail" style="display:none"><pre>${this._escapeHtml(content)}</pre></div>
      </div>`;
    });

    html += `</div></div>`;

    html += `<div class="debug-history-section">
      <h3>📋 显示消息 (${display.length} 条)</h3>
      <div class="debug-history-list">`;

    display.slice(-50).forEach((m, i) => {
      const role = m.role || 'unknown';
      const text = (m.text || m.english || m.chinese || '').slice(0, 80);
      const roleClass = role === 'user' ? 'user' : (role === 'assistant' || role === 'bot' ? 'assistant' : 'system');
      html += `<div class="debug-history-entry ${roleClass}">
        <span class="debug-history-idx">#${display.length - 50 + i}</span>
        <span class="debug-history-role ${roleClass}">${role}</span>
        <span class="debug-history-preview">${this._escapeHtml(text)}${text.length >= 80 ? '...' : ''}</span>
        <span class="debug-history-time">${m.time ? new Date(m.time).toLocaleTimeString('zh-CN', { hour12: false }) : ''}</span>
      </div>`;
    });

    html += `</div></div>`;
    body.innerHTML = html;
    this._updateStatusBar();
  },

  // --- Helpers ---
  _toggleDetail(el) {
    const detail = el.querySelector('.debug-log-detail, .debug-req-detail, .debug-history-detail');
    if (detail) {
      detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    }
  },

  _getMetrics() {
    const completed = this.requests.filter(r => r.endTime);
    const success = completed.filter(r => r.status >= 200 && r.status < 300);
    const failed = completed.filter(r => r.status === 'error' || r.status >= 400);
    const withTTF = completed.filter(r => r.firstTokenTime);

    const avgTTF = withTTF.length > 0
      ? (withTTF.reduce((s, r) => s + (r.firstTokenTime - r.startTime), 0) / withTTF.length).toFixed(0)
      : '-';
    const avgDuration = completed.length > 0
      ? (completed.reduce((s, r) => s + (r.endTime - r.startTime), 0) / completed.length).toFixed(0)
      : '-';
    const totalChars = completed.reduce((s, r) => s + r.totalChars, 0);

    return {
      totalRequests: this.requests.length,
      successRequests: success.length,
      failedRequests: failed.length,
      avgTTF,
      avgDuration,
      totalChars
    };
  },

  _updateStatusBar() {
    const el = document.getElementById('debugStatusBar');
    if (el) {
      el.textContent = `日志: ${this.logs.length} | 请求: ${this.requests.length} | 完成: ${this.requests.filter(r => r.endTime).length}`;
    }
  },

  clearCurrentTab() {
    switch (this._activeTab) {
      case 'logs': this.logs = []; break;
      case 'requests': this.requests = []; break;
      case 'history': break; // Can't clear app state
    }
    this._renderActiveTab();
  },

  exportLogs() {
    const data = {
      exportTime: new Date().toISOString(),
      logs: this.logs,
      requests: this.requests.map(r => ({
        ...r,
        request: { ...r.request, _fullBody: undefined }
      })),
      metrics: this._getMetrics()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('调试日志已导出');
  },

  // --- Console Interception ---
  _interceptConsole() {
    // Store originals (already used in _log)
    // We intercept to capture any external library logs too
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    // Don't re-intercept if our _log already calls originals
    // (We handle this in _log itself, no double interception needed)
  },

  // --- Utility ---
  _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');
  },

  _shortenUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch(e) {
      return url?.slice(0, 60) || '';
    }
  },

  _truncateForLog(obj, maxLen) {
    try {
      const str = JSON.stringify(obj);
      if (str.length <= maxLen) return JSON.parse(str);
      // Truncate messages content
      const clone = JSON.parse(str);
      if (clone.messages) {
        clone.messages = clone.messages.map(m => ({
          ...m,
          content: typeof m.content === 'string'
            ? m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '')
            : m.content
        }));
      }
      return clone;
    } catch(e) {
      return null;
    }
  },

  _safeStringify(obj, maxLen) {
    try {
      const str = JSON.stringify(obj, null, 2);
      return str.length > maxLen ? str.slice(0, maxLen) + '\n...(truncated)' : str;
    } catch(e) {
      return String(obj);
    }
  }
};

// === API Interception Wrappers ===
// These wrap the existing API functions to add debug logging

(function() {
  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDebugInterception);
  } else {
    initDebugInterception();
  }

  function initDebugInterception() {
    // Intercept callMiMoAPI
    const origCallMiMoAPI = window.callMiMoAPI;
    if (origCallMiMoAPI) {
      window.callMiMoAPI = async function(options) {
        const reqId = Debug.startRequest('POST', MIMO_API_URL, {
          model: options.model || (typeof chatModel !== 'undefined' ? chatModel : MIMO_MODEL_PRO),
          max_tokens: options.max_tokens,
          stream: false,
          messages: options.messages,
          tools: options.tools
        });

        const startTime = performance.now();
        try {
          const result = await origCallMiMoAPI.call(this, options);
          Debug.recordFirstToken(reqId); // Non-streaming: first token = end
          Debug.endRequest(reqId, 200, result);
          return result;
        } catch(err) {
          Debug.failRequest(reqId, err);
          throw err;
        }
      };
    }

    // Intercept callMiMoAPIStream
    const origCallMiMoAPIStream = window.callMiMoAPIStream;
    if (origCallMiMoAPIStream) {
      window.callMiMoAPIStream = async function(options) {
        const reqId = Debug.startRequest('POST', MIMO_API_URL, {
          model: options.model || (typeof chatModel !== 'undefined' ? chatModel : MIMO_MODEL_PRO),
          max_tokens: options.max_tokens,
          stream: true,
          messages: options.messages,
          tools: options.tools
        });

        const origOnChunk = options.onChunk;
        let firstTokenRecorded = false;
        options.onChunk = function(accumulated) {
          if (!firstTokenRecorded && accumulated.length > 0) {
            Debug.recordFirstToken(reqId);
            firstTokenRecorded = true;
          }
          Debug.recordChunk(reqId, accumulated.length);
          if (origOnChunk) origOnChunk.apply(this, arguments);
        };

        try {
          const result = await origCallMiMoAPIStream.call(this, options);
          Debug.endRequest(reqId, 200, result);
          return result;
        } catch(err) {
          Debug.failRequest(reqId, err);
          throw err;
        }
      };
    }

    // Intercept fetchTTSForMessage
    const origFetchTTS = window.fetchTTSForMessage;
    if (origFetchTTS) {
      window.fetchTTSForMessage = async function(english, index) {
        Debug.logTTS(index, 'start');
        try {
          const result = await origFetchTTS.apply(this, arguments);
          if (result && result.audioUrl) {
            Debug.logTTS(index, 'done', `(${(result.savedAudioId ? 'saved' : 'no-save')})`);
          } else {
            Debug.logTTS(index, 'error', 'no audio returned');
          }
          return result;
        } catch(err) {
          Debug.logTTS(index, 'error', err.message);
          throw err;
        }
      };
    }

    // Initialize Debug module
    Debug.init();
  }
})();
