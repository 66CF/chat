// ============================================================
// === Debug Mode — 简化版调试模式 ===
// ============================================================
// 功能：API 请求/响应日志、性能计时、状态监控
// 为 AI 助手查看优化，简化 UI

const Debug = {
  enabled: false,
  logs: [],           // { time, level, category, message, data }
  requests: [],       // { id, method, url, model, startTime, firstTokenTime, endTime, status, request, response, error }
  maxLogs: 200,
  maxRequests: 30,
  _reqCounter: 0,
  _panel: null,
  _autoScroll: true,

  // --- Init ---
  init() {
    // Check localStorage for saved preference
    const saved = localStorage.getItem('vbc_debug_mode');
    if (saved === '1') this.enable();

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
    if (this.enabled) this._appendLogEntry(entry);
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
        thinking: body?.thinking?.type || 'default',
        messageCount: body?.messages?.length,
        systemLength: body?.messages?.[0]?.role === 'system' ? (body?.messages?.[0]?.content?.length || 0) : 0,
        tools: body?.tools?.length || 0,
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
      preview: (responseText || '').slice(0, 300)
    };

    if (status >= 200 && status < 300) {
      this.info('api', `✓ [${reqId}] ${status} 总耗时 ${totalMs}ms (TTF ${ttf}ms, ${req.chunkCount} chunks, ${req.totalChars} chars)`);
    } else {
      this.warn('api', `✗ [${reqId}] ${status} ${totalMs}ms`, responseText?.slice(0, 200));
    }
  },

  failRequest(reqId, error) {
    const req = this.requests.find(r => r.id === reqId);
    if (!req) return;
    req.endTime = performance.now();
    req.status = 'error';
    req.error = error?.message || String(error);
    const totalMs = (req.endTime - req.startTime).toFixed(0);
    this.error('api', `✗ [${reqId}] 错误 ${totalMs}ms: ${req.error}`);
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

  // --- UI (简化版) ---
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
      this._renderAllLogs();
      return;
    }
    this._createPanel();
    this._renderAllLogs();
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
        <div class="debug-panel-title">
          <span>🐛 调试日志</span>
          <span class="debug-panel-hint">Ctrl+Shift+D 切换</span>
        </div>
        <div class="debug-panel-actions">
          <label class="debug-auto-scroll">
            <input type="checkbox" id="debugAutoScroll" checked onchange="Debug._autoScroll=this.checked" />
            自动滚动
          </label>
          <button class="debug-btn-sm" onclick="Debug.clearLogs()">清空</button>
          <button class="debug-btn-sm" onclick="Debug.exportLogs()">导出</button>
          <button class="debug-panel-close" onclick="Debug.toggle()">✕</button>
        </div>
      </div>
      <div class="debug-panel-body" id="debugPanelBody"></div>
      <div class="debug-panel-footer">
        <span id="debugStatusBar">日志: ${this.logs.length} | 请求: ${this.requests.length}</span>
        <span class="debug-hint">点击条目查看详情</span>
      </div>
    `;
    document.body.appendChild(panel);
    this._panel = panel;
  },

  _appendLogEntry(entry) {
    const body = document.getElementById('debugPanelBody');
    if (!body) return;

    const time = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ms = String(new Date(entry.time).getMilliseconds()).padStart(3, '0');
    const levelClass = entry.level;
    const dataStr = entry.data ? `\n${this._formatData(entry.data)}` : '';

    const div = document.createElement('div');
    div.className = `debug-log-entry ${levelClass}`;
    div.onclick = () => this._toggleDetail(div);
    div.innerHTML = `
      <span class="debug-log-time">${time}.${ms}</span>
      <span class="debug-log-level">${entry.level.toUpperCase()}</span>
      <span class="debug-log-cat">[${entry.category}]</span>
      <span class="debug-log-msg">${this._escapeHtml(entry.message)}</span>
      ${entry.data ? `<div class="debug-log-detail" style="display:none">${this._escapeHtml(dataStr)}</div>` : ''}
    `;

    body.appendChild(div);

    // Auto-scroll
    if (this._autoScroll) {
      body.scrollTop = body.scrollHeight;
    }

    this._updateStatusBar();
  },

  _renderAllLogs() {
    const body = document.getElementById('debugPanelBody');
    if (!body) return;

    const html = this.logs.map(l => {
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

    body.innerHTML = html;

    if (this._autoScroll) {
      body.scrollTop = body.scrollHeight;
    }
    this._updateStatusBar();
  },

  // --- Helpers ---
  _toggleDetail(el) {
    const detail = el.querySelector('.debug-log-detail');
    if (detail) {
      detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
    }
  },

  _formatData(data) {
    if (data === null || data === undefined) return '';
    if (typeof data === 'string') return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  },

  _updateStatusBar() {
    const el = document.getElementById('debugStatusBar');
    if (el) {
      el.textContent = `日志: ${this.logs.length} | 请求: ${this.requests.length} | 完成: ${this.requests.filter(r => r.endTime).length}`;
    }
  },

  clearLogs() {
    this.logs = [];
    this._renderAllLogs();
  },

  exportLogs() {
    const data = {
      exportTime: new Date().toISOString(),
      logs: this.logs,
      requests: this.requests,
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
          thinking: options.thinking || { type: 'disabled' },
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
          thinking: options.thinking || { type: 'disabled' },
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