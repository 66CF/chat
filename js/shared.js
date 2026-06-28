// ============================================================
// === Shared Utilities — 公共工具函数 ===
// ============================================================
// 提取自多个文件的重复代码，统一管理


// === 1. 对话历史公共函数 ===

/**
 * 获取最近的对话历史（过滤空消息）
 * 替代到处重复的 conversationHistory.slice(-20).filter(m => m.content && ...)
 */
function getRecentMessages(count = 20) {
  return conversationHistory.slice(-count).filter(
    m => m.content && (typeof m.content !== "string" || m.content.trim())
  );
}

/**
 * 公共 pre-API 步骤：构建系统提示 + 推送用户消息到历史
 * 用于大多数"用户发送消息→机器人回复"的场景
 * 
 * @param {string} searchText - 用于记忆召回搜索的文本
 * @param {string|Array} userContent - 推送到 conversationHistory 的内容
 * @param {string} [logText] - 推送到 imprintLogTurn 的文本（默认用 userContent）
 * @returns {Promise<string>} 系统提示词
 */
async function prepareBotContext(searchText, userContent, logText) {
  const systemPrompt = await buildSystemWithRecall(searchText);
  conversationHistory.push({ role: "user", content: userContent });
  imprintLogTurn("user", logText || (typeof userContent === "string" ? userContent : ""));
  return systemPrompt;
}

/**
 * 公共 post-API 步骤：保存回复到历史 + 解析 + 显示
 * 替代各处重复的 conversationHistory.push + imprintLogTurn + parseMiMoResponse + showMultipleMessages
 * 
 * @param {string} rawText - API 返回的原始文本
 * @param {Object} [options]
 * @param {boolean} [options.skipDisplay=false] - 跳过显示（streaming 模式已内部处理显示）
 * @returns {Promise<Array>} 解析后的消息数组
 */
async function handleBotReply(rawText, options = {}) {
  const { skipDisplay = false } = options;

  conversationHistory.push({ role: "assistant", content: rawText });
  imprintLogTurn("assistant", rawText);

  const messages = parseMiMoResponse(rawText);

  if (!skipDisplay) {
    setLoading(false);
    await showMultipleMessages(messages);
  }

  return messages;
}


// === 2. Streaming + TTS 公共函数 ===
/**
 * 流式 API 调用 + 并行 TTS 生成
 * 提取自 voice.js、app.js、chat.js、chat-batch.js 的重复代码
 * 
 * @param {Object} options
 * @param {string} options.system - 系统提示词
 * @param {Array} options.messages - 消息数组
 * @param {number} options.max_tokens - 最大 token 数
 * @param {Array} options.tools - 工具列表
 * @param {Function} options.onProgress - 进度回调 (completedCount)
 * @returns {Promise<{rawText: string, messages: Array}>}
 */
async function streamWithTTS(options) {
  const { system, messages, max_tokens = 128000, tools = [], onProgress } = options;
  
  // 创建流式消息处理器
  const proc = createStreamMessageProcessor();
  let completedMsgCount = 0;
  let earlyTTSDone = 0;
  const ttsMap = {};
  
  // TTS 触发函数（带缓存，避免重复请求）
  function fireTTS(index, english) {
    if (!ttsMap[index]) {
      ttsMap[index] = fetchTTSForMessage(english, index);
    }
    return ttsMap[index];
  }

  // 并行执行流式 API 和消息显示
  const [, rawText] = await Promise.all([
    proc.finished,
    (async () => {
      const rawText = await callMiMoAPIStream({
        system,
        messages,
        max_tokens,
        tools,
        onChunk: (accumulated) => {
          // 检测新的完整消息
          const msgs = extractCompleteMessages(accumulated);
          for (let i = completedMsgCount; i < msgs.length; i++) {
            const m = msgs[i];
            const p = fireTTS(i, m.english);
            proc.enqueue(m, p);
            completedMsgCount++;
          }

          // 提前触发 TTS（当 english 字段完成时）
          const readyEnglish = extractReadyEnglish(accumulated);
          for (let i = earlyTTSDone; i < readyEnglish.length; i++) {
            fireTTS(i, readyEnglish[i]);
            earlyTTSDone++;
          }

          // 回调进度
          if (onProgress) {
            onProgress(completedMsgCount);
          }
        }
      });

      // 兜底：处理流式中未检测到的消息
      const finalMsgs = parseMiMoResponse(rawText);
      for (let i = completedMsgCount; i < finalMsgs.length; i++) {
        const m = finalMsgs[i];
        const p = fireTTS(i, m.english);
        proc.enqueue(m, p);
        completedMsgCount++;
      }

      proc.done(); // 通知显示循环结束
      return rawText;
    })()
  ]);

  // 获取最终消息（复用流式中已解析的，避免重复解析）
  const messages_result = parseMiMoResponse(rawText);
  
  return { rawText, messages: messages_result };
}


// === 3. Blob URL 管理器 ===
/**
 * 管理 Blob URL 的生命周期，防止内存泄漏
 */
const BlobManager = {
  _urls: new Map(), // url -> { created: timestamp, element: HTMLElement }
  _maxAge: 3600000, // 1 小时后清理
  _cleanupInterval: null,

  /**
   * 创建 Blob URL 并注册跟踪
   */
  create(blob, element) {
    const url = URL.createObjectURL(blob);
    this._urls.set(url, {
      created: Date.now(),
      element: element || null
    });
    this._startCleanup();
    return url;
  },

  /**
   * 释放单个 Blob URL
   */
  revoke(url) {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
      this._urls.delete(url);
    }
  },

  /**
   * 释放元素关联的所有 Blob URL
   */
  revokeForElement(element) {
    for (const [url, info] of this._urls.entries()) {
      if (info.element === element) {
        URL.revokeObjectURL(url);
        this._urls.delete(url);
      }
    }
  },

  /**
   * 清理过期的 Blob URL
   */
  cleanup() {
    const now = Date.now();
    for (const [url, info] of this._urls.entries()) {
      if (now - info.created > this._maxAge) {
        URL.revokeObjectURL(url);
        this._urls.delete(url);
      }
    }
  },

  /**
   * 清理所有 Blob URL
   */
  revokeAll() {
    for (const url of this._urls.keys()) {
      URL.revokeObjectURL(url);
    }
    this._urls.clear();
  },

  /**
   * 启动定期清理
   */
  _startCleanup() {
    if (!this._cleanupInterval) {
      this._cleanupInterval = setInterval(() => this.cleanup(), 300000); // 每 5 分钟清理
    }
  },

  /**
   * 停止定期清理
   */
  stopCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  },

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      total: this._urls.size,
      oldest: Math.min(...Array.from(this._urls.values()).map(i => i.created))
    };
  }
};

// 页面卸载时清理所有 Blob URL
window.addEventListener('beforeunload', () => {
  BlobManager.revokeAll();
  BlobManager.stopCleanup();
});


// === 4. 统一错误处理 ===
/**
 * 错误处理器 - 提供用户友好的错误信息和日志记录
 */
const ErrorHandler = {
  // 错误类型映射
  ERROR_TYPES: {
    NETWORK: { code: 'NETWORK', message: '网络连接失败，请检查网络', icon: '🌐' },
    API_KEY: { code: 'API_KEY', message: 'API Key 无效或已过期', icon: '🔑' },
    RATE_LIMIT: { code: 'RATE_LIMIT', message: '请求太频繁，请稍后再试', icon: '⏳' },
    TIMEOUT: { code: 'TIMEOUT', message: '请求超时，请重试', icon: '⏱️' },
    PARSE_ERROR: { code: 'PARSE_ERROR', message: '解析响应失败', icon: '📄' },
    PERMISSION: { code: 'PERMISSION', message: '权限不足', icon: '🔒' },
    UNKNOWN: { code: 'UNKNOWN', message: '发生未知错误', icon: '❌' }
  },

  /**
   * 处理错误
   * @param {Error} error - 原始错误对象
   * @param {string} context - 错误发生上下文
   * @param {Object} options - 配置选项
   * @param {boolean} options.showToUser - 是否显示给用户
   * @param {boolean} options.showToast - 是否显示 toast
   * @param {boolean} options.logToConsole - 是否记录到控制台
   * @returns {Object} 错误信息
   */
  handle(error, context = '', options = {}) {
    const { showToUser = true, showToast = true, logToConsole = true } = options;
    
    // 识别错误类型
    const errorType = this._identifyError(error);
    
    // 构建错误信息
    const errorInfo = {
      type: errorType.code,
      message: errorType.message,
      icon: errorType.icon,
      original: error.message,
      context,
      timestamp: Date.now()
    };

    // 记录到控制台
    if (logToConsole) {
      console.error(`[${context}] ${errorType.code}:`, error);
    }

    // 记录到 Debug 系统（如果存在）
    if (typeof Debug !== 'undefined' && Debug.enabled) {
      Debug.error(context, errorType.message, error.stack);
    }

    // 显示给用户
    if (showToUser) {
      showError(`${errorType.icon} ${errorType.message}`);
    }

    // 显示 toast
    if (showToast) {
      showToast(errorType.message, 3000);
    }

    return errorInfo;
  },

  /**
   * 识别错误类型
   */
  _identifyError(error) {
    const message = error.message?.toLowerCase() || '';
    const status = error.status || error.statusCode;

    // 网络错误
    if (!navigator.onLine || message.includes('network') || message.includes('fetch')) {
      return this.ERROR_TYPES.NETWORK;
    }

    // API Key 错误
    if (status === 401 || message.includes('unauthorized') || message.includes('api key')) {
      return this.ERROR_TYPES.API_KEY;
    }

    // 速率限制
    if (status === 429 || message.includes('rate limit') || message.includes('too many')) {
      return this.ERROR_TYPES.RATE_LIMIT;
    }

    // 超时
    if (message.includes('timeout') || message.includes('abort')) {
      return this.ERROR_TYPES.TIMEOUT;
    }

    // 解析错误
    if (message.includes('parse') || message.includes('json') || message.includes('unexpected token')) {
      return this.ERROR_TYPES.PARSE_ERROR;
    }

    // 权限错误
    if (status === 403 || message.includes('permission') || message.includes('forbidden')) {
      return this.ERROR_TYPES.PERMISSION;
    }

    // 未知错误
    return this.ERROR_TYPES.UNKNOWN;
  },

  /**
   * 包装异步函数，自动处理错误
   */
  wrap(fn, context, options = {}) {
    return async function(...args) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        ErrorHandler.handle(error, context, options);
        throw error; // 重新抛出，让调用者决定是否处理
      }
    };
  }
};


// === 5. 输入验证和清理 ===
/**
 * 输入验证器
 */
const InputValidator = {
  /**
   * 清理用户输入，移除潜在危险内容
   */
  sanitize(text) {
    if (typeof text !== 'string') return '';
    
    return text
      // 移除 script 标签
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // 移除事件处理器
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
      // 移除 javascript: 协议
      .replace(/javascript\s*:/gi, '')
      // 修剪空白
      .trim();
  },

  /**
   * 验证消息长度
   */
  validateMessageLength(text, maxLength = 10000) {
    if (text.length > maxLength) {
      return {
        valid: false,
        message: `消息太长（${text.length}/${maxLength} 字符）`
      };
    }
    return { valid: true };
  },

  /**
   * 验证文件大小
   */
  validateFileSize(size, maxSize = 10 * 1024 * 1024) {
    if (size > maxSize) {
      const sizeMB = (size / 1024 / 1024).toFixed(1);
      const maxMB = (maxSize / 1024 / 1024).toFixed(0);
      return {
        valid: false,
        message: `文件太大（${sizeMB}MB / 最大 ${maxMB}MB）`
      };
    }
    return { valid: true };
  },

  /**
   * 验证文件类型
   */
  validateFileType(filename, allowedTypes) {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (!allowedTypes.includes(ext)) {
      return {
        valid: false,
        message: `不支持的文件类型: .${ext}`
      };
    }
    return { valid: true };
  }
};


// === 6. 性能监控 ===
/**
 * 性能监控工具
 */
const PerfMonitor = {
  _marks: new Map(),
  _measures: [],

  /**
   * 开始计时
   */
  start(name) {
    this._marks.set(name, performance.now());
  },

  /**
   * 结束计时并返回耗时
   */
  end(name) {
    const startTime = this._marks.get(name);
    if (!startTime) return 0;
    
    const duration = performance.now() - startTime;
    this._marks.delete(name);
    
    this._measures.push({
      name,
      duration,
      timestamp: Date.now()
    });

    // 只保留最近 100 条记录
    if (this._measures.length > 100) {
      this._measures = this._measures.slice(-100);
    }

    return duration;
  },

  /**
   * 获取性能统计
   */
  getStats(name) {
    const measures = this._measures.filter(m => m.name === name);
    if (measures.length === 0) return null;

    const durations = measures.map(m => m.duration);
    return {
      count: measures.length,
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      last: durations[durations.length - 1]
    };
  },

  /**
   * 获取所有统计
   */
  getAllStats() {
    const stats = {};
    const names = new Set(this._measures.map(m => m.name));
    for (const name of names) {
      stats[name] = this.getStats(name);
    }
    return stats;
  }
};
