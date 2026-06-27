// === Setup ===
const mimoInput = document.getElementById("mimoKey");
const googleInput = document.getElementById("googleKey");
const startButton = document.getElementById("startBtn");

function checkKeys() {
  startButton.disabled = !mimoInput.value.trim();
}
mimoInput.addEventListener("input", checkKeys);
googleInput.addEventListener("input", checkKeys);
mimoInput.addEventListener("keydown", e => {
  if (e.key === "Enter") startChat();
});
googleInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !startButton.disabled) startChat();
});

async function startChat() {
  mimoApiKey = mimoInput.value.trim();
  googleApiKey = googleInput.value.trim();
  if (!mimoApiKey) return;

  saveKeys();
  saveSettingsToMemory(); // Sync keys + settings to memory library
  document.getElementById("setup").classList.add("hidden");
  document.getElementById("chatInput").disabled = false;
  document.getElementById("sendBtn").disabled = false;
  document.getElementById("modeBtn").disabled = false;
  document.getElementById("callBtn").disabled = false;
  document.getElementById("statusBar").textContent = "在线 · 语音已连接";

  // NOTE: 不再预先请求麦克风权限，避免 Android 手机音量变成电话模式
  // 麦克风权限会在用户第一次使用语音功能时延迟获取
  // initMicStream();

  // Load stickers from static files
  loadStickers();

  // Start proactive messaging & notifications
  // Only read from localStorage if memory library hasn't loaded settings already
  if (!memoryLoaded) {
    const savedProactive = localStorage.getItem("vbc_proactive");
    proactiveEnabled = savedProactive !== "0"; // default on
    const savedWebSearch = localStorage.getItem("vbc_websearch");
    webSearchEnabled = savedWebSearch === "1"; // default off
    // chatModel — restore from localStorage (header toggle saves it)
    const savedModel = localStorage.getItem("vbc_model");
    if (savedModel === MIMO_MODEL_PRO || savedModel === MIMO_MODEL_FLASH) chatModel = savedModel;
  }
  const pBtn = document.getElementById("proactiveBtn");
  pBtn.textContent = proactiveEnabled ? "💬 主动消息:开" : "💬 主动消息:关";
  pBtn.style.opacity = proactiveEnabled ? "1" : "0.5";
  requestNotificationPermission();
  if (proactiveEnabled) scheduleProactiveMessage(0.3); // first message in ~20 seconds

  // Restore web search toggle
  const wBtn = document.getElementById("webSearchBtn");
  wBtn.textContent = webSearchEnabled ? "🔍 联网:开" : "🔍 联网:关";
  wBtn.style.opacity = webSearchEnabled ? "1" : "0.5";

  // Restore model toggle
  const mBtn = document.getElementById("modelBtn");
  const isPro = chatModel === MIMO_MODEL_PRO;
  mBtn.textContent = isPro ? "🧠 Pro" : "⚡ Flash";
  mBtn.title = isPro ? "当前: Pro（更强）\n点击切换到 Flash" : "当前: Flash（更快）\n点击切换到 Pro";

  // Restore chat messages (memory library > localStorage)
  // Load chat history from memory library
  if (!memoryLoaded && !memoryEnabled) {
    // No memory library connected — try loading from localStorage backup
    const loadedFromBackup = loadChatHistoryFromStorage();
    if (loadedFromBackup) {
      document.getElementById("statusBar").textContent = "✅ 已从本地缓存恢复聊天记录";
    } else {
      // No backup either — hint user
      setTimeout(() => {
        if (!memoryEnabled) {
          document.getElementById("statusBar").textContent = "💡 点击「📁 记忆库」设置本地文件夹保存记忆";
        }
      }, 3000);
    }
  }

  if (chatMessages.length > 0) {
    const empty = document.getElementById("emptyState");
    if (empty) empty.remove();
    // Lazy load: only render last CHAT_PAGE_SIZE messages initially
    chatRenderStart = Math.max(0, chatMessages.length - CHAT_PAGE_SIZE);
    const slice = chatMessages.slice(chatRenderStart);
    // Use for...of with await to preserve message order
    for (const msg of slice) {
      await renderOneMessage(msg);
    }
    // Show "load more" banner if there are older messages
    if (chatRenderStart > 0) insertLoadMoreBanner();
    // Scroll listener for auto-loading older messages
    if (!_scrollListenerAdded) {
      const chatArea = document.getElementById("chatArea");
      chatArea.addEventListener("scroll", onChatScrollTop);
      _scrollListenerAdded = true;
    }
  }

  document.getElementById("chatInput").focus();
}

function clearChat() {
  if (!confirm("确定要清空所有聊天记录吗？")) return;
  conversationHistory = [];
  chatMessages = [];
  stagedMessages = [];
  renderStagedBar();
  clearReply();
  AudioDB.clear();
  saveChatHistory(); // Save empty state to memory library
  document.getElementById("chatArea").innerHTML = `
    <div class="empty-state" id="emptyState">
      <span>💬</span><div>说点什么吧，我在听</div>
    </div>`;
}

function logout() {
  localStorage.removeItem("vbc_claude_key");
  localStorage.removeItem("vbc_eleven_key");
  localStorage.removeItem("vbc_openai_key");
  localStorage.removeItem("vbc_mimo_key");
  localStorage.removeItem("vbc_google_key");
  location.reload();
}



// === Proactive Messages (【角色身份】 texts you first) ===
let proactiveTimer = null;
let lastMessageTime = 0;
let proactiveEnabled = true;
let proactiveSending = false;

function getTimeContext() {
  const h = new Date().getHours();
  const hhmm = String(h).padStart(2,"0") + ":" + String(new Date().getMinutes()).padStart(2,"0");
  if (h >= 6 && h < 9) return `${hhmm} — early morning, 【用户称呼代词】 might just be waking up`;
  if (h >= 9 && h < 12) return `${hhmm} — morning, 【用户称呼代词】 might be busy with work or class`;
  if (h >= 12 && h < 14) return `${hhmm} — lunchtime`;
  if (h >= 14 && h < 17) return `${hhmm} — afternoon`;
  if (h >= 17 && h < 19) return `${hhmm} — early evening, 【用户称呼代词】 might be done with work/class`;
  if (h >= 19 && h < 22) return `${hhmm} — evening, relaxing time`;
  if (h >= 22 || h < 1) return `${hhmm} — late night, 【用户称呼代词】 might be getting ready for bed`;
  return `${hhmm} — very late at night, 【用户称呼代词】's probably sleeping`;
}

function buildProactivePrompt() {
  const timeSinceChat = lastMessageTime ? Math.floor((Date.now() - lastMessageTime) / 60000) : -1;
  const timeCtx = getTimeContext();
  const chatLen = conversationHistory.length;

  // Build a quick summary of recent messages for context
  const recentMsgs = conversationHistory.slice(-20);
  let recentSummary = "";
  if (recentMsgs.length > 0) {
    recentSummary = "\n--- RECENT CONVERSATION (read this carefully!) ---\n";
    for (const msg of recentMsgs) {
      const role = msg.role === "user" ? "【用户称呼代词简称，如：她/他】" : "你";
      let text = msg.content || "";
      if (typeof text !== "string") text = JSON.stringify(text);
      try {
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        if (Array.isArray(parsed)) text = parsed.map(m => m.chinese || m.english).join(" / ");
        else if (parsed.chinese) text = parsed.chinese;
      } catch(e) {}
      if (text.length > 80) text = text.slice(0, 80) + "...";
      recentSummary += `${role}: ${text}\n`;
    }
    recentSummary += "--- END OF RECENT CONVERSATION ---\n";
  }

  const prompt = `[SYSTEM: PROACTIVE MESSAGE MODE]

You are initiating a message to 【用户称呼代词】 — 【用户称呼代词】 did NOT text you.

Current time: ${timeCtx}
${timeSinceChat >= 0 ? `Minutes since last message: ${timeSinceChat}` : "You haven't talked yet today — this is your first message."}
Messages exchanged so far: ${chatLen}
${recentSummary}
CRITICAL RULES FOR CONTEXT AWARENESS:
- READ THE CONVERSATION HISTORY ABOVE CAREFULLY before composing your message.
- Your message MUST logically follow from what you two have been talking about.
- If you've been chatting actively, DO NOT say "good morning" or "are you awake" — 【用户称呼代词】's obviously awake.
- If you just talked about a topic, you can follow up on it, react to it, or bring up something related.
- DO NOT repeat things you already said. DO NOT ask questions 【用户称呼代词】 already answered.
- If 【用户称呼代词】 hasn't replied in a while, you can reference what you were talking about earlier.
- Be natural — think about what a real 【角色身份】 would text GIVEN the conversation you just had.

RESPONSE FORMAT — JSON ARRAY with 1-3 messages. Add "wait" on the LAST message only:
[{"english":"first msg","chinese":"第一条"},{"english":"second msg","chinese":"第二条","wait":3}]

The "wait" field = minutes before your NEXT proactive message if 【用户称呼代词】 doesn't reply.
- 0 = double-text immediately (【角色会立刻连发消息的情绪场景，如：clingy moments】, don't overdo)
- 1-3 = 【角色较快再次发消息的心理状态，如：feeling clingy, will text again soon】  
- 5-10 = check in later
- -1 = wait for 【用户称呼代词】 to reply

Stay fully in character. Be natural. Vary your messages.`;

  return prompt;
}

function scheduleProactiveMessage(delayMinutes) {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  if (!proactiveEnabled || delayMinutes < 0) return;
  const ms = Math.max(delayMinutes * 60 * 1000, 3000); // minimum 3 seconds
  proactiveTimer = setTimeout(sendProactiveMessage, ms);
}

async function sendProactiveMessage() {
  if (!proactiveEnabled || isInCall || !mimoApiKey || proactiveSending || isBusy) return;
  proactiveSending = true;

  try {
    // 40% chance to peek at screen instead of normal message (if enabled)
    if (peekEnabled && Math.random() < 0.4) {
      const peeked = await peekAndReact(false);
      if (peeked) {
        proactiveSending = false;
        // After peeking, schedule next proactive normally
        scheduleProactiveMessage(3 + Math.random() * 5);
        return;
      }
    }

    const prompt = buildProactivePrompt();

    // Get recall for proactive context
    let recallBlock = "";
    try {
      if (ImprintMemory.chunks.length > 0) {
        const recalled = await ImprintMemory.surfacingSearch("主动消息 聊天 近况");
        if (recalled) recallBlock = `\n\n<recall>\n以下是你对【用户与角色的关系】的长期记忆片段，自然地运用但不要刻意提起：\n${recalled}\n</recall>`;
      }
    } catch(e) {}

    const reqMsgs = [
      ...conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
      { role: "user", content: prompt }
    ];

    // === Streaming + Parallel TTS ===
    const ttsPromisesMap = new Map();
    let detectedCount = 0;
    let ttsStartedCount = 0;
    let cachedParsedMsgs = [];
    function ensureTTS(index, english) {
      if (ttsPromisesMap.has(index)) return;
      ttsPromisesMap.set(index, fetchTTSForMessage(english, index));
    }

    const rawText = await callMiMoAPIStream({
      system: SYSTEM_PROMPT + recallBlock,
      messages: reqMsgs,
      max_tokens: 500,
      onChunk: (accumulated) => {
        cachedParsedMsgs = extractCompleteMessages(accumulated);
        detectedCount = Math.max(detectedCount, cachedParsedMsgs.length);

        // Early TTS: fire as soon as english field is closed in stream
        const readyEnglish = extractReadyEnglish(accumulated);
        for (let i = ttsStartedCount; i < readyEnglish.length; i++) {
          ensureTTS(i, readyEnglish[i]);
        }
        ttsStartedCount = Math.max(ttsStartedCount, readyEnglish.length);
      }
    });

    // Parse: reuse cached messages from streaming, extract "wait" from last element
    let messages = [], waitMinutes = -1;
    if (cachedParsedMsgs.length > 0) {
      messages = filterParsedMessages(cachedParsedMsgs);
      const last = messages[messages.length - 1];
      if (last && typeof last.wait === "number") waitMinutes = last.wait;
    } else {
      const clean = (rawText || "").replace(/```json|```/g, "").trim();
      try {
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) {
          messages = parsed;
        } else if (parsed.english) {
          messages = [parsed];
        }
        const last = messages[messages.length - 1];
        if (last && typeof last.wait === "number") waitMinutes = last.wait;
      } catch(e) {
        const engM = clean.match(/"english"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const chnM = clean.match(/"chinese"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const waitM = clean.match(/"wait"\s*:\s*(-?\d+)/);
        if (engM && chnM) {
          messages = [{ english: engM[1].replace(/\\"/g,'"'), chinese: chnM[1].replace(/\\"/g,'"') }];
          waitMinutes = waitM ? parseInt(waitM[1]) : -1;
        } else throw new Error("Parse error");
      }
    }

    if (messages.length === 0) throw new Error("Empty response");

    // Ensure all TTS jobs are started
    for (let i = 0; i < messages.length; i++) {
      ensureTTS(i, messages[i].english);
    }

    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);

    const empty = document.getElementById("emptyState");
    if (empty) empty.remove();

    // Show all messages with parallel TTS (prefetched during streaming)
    await showMultipleMessages(messages, ttsPromisesMap);
    lastMessageTime = Date.now();

    // Browser notification (show last message)
    try {
      if (Notification.permission === "granted" && document.hidden) {
        const lastMsg = messages[messages.length - 1];
        new Notification("MiMo 💕", {
          body: cleanTags(lastMsg.chinese),
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>💕</text></svg>"
        });
      }
    } catch(e) {}

    // Schedule next based on MiMo's decision
    proactiveSending = false;
    if (proactiveEnabled && waitMinutes >= 0) {
      scheduleProactiveMessage(waitMinutes);
    }

  } catch(err) {
    console.warn("Proactive message error:", err);
    proactiveSending = false;
    // Retry in 5 min on error
    scheduleProactiveMessage(5);
  }
}

// Request notification permission
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function toggleProactive() {
  proactiveEnabled = !proactiveEnabled;
  const btn = document.getElementById("proactiveBtn");
  btn.textContent = proactiveEnabled ? "💬 主动消息:开" : "💬 主动消息:关";
  btn.style.opacity = proactiveEnabled ? "1" : "0.5";
  if (proactiveEnabled) {
    scheduleProactiveMessage(0.5); // start soon
  } else {
    if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
  }
  saveSettingsToMemory();
  localStorage.setItem("vbc_proactive", proactiveEnabled ? "1" : "0");
}

// === Screen Peek (视监模式) ===
let screenStream = null;
let screenVideo = null;
let peekEnabled = false;

// === Model Switcher ===
let chatModel = MIMO_MODEL_PRO;
function toggleModel() {
  if (chatModel === MIMO_MODEL_PRO) {
    chatModel = MIMO_MODEL_FLASH;
  } else {
    chatModel = MIMO_MODEL_PRO;
  }
  const btn = document.getElementById("modelBtn");
  const isPro = chatModel === MIMO_MODEL_PRO;
  btn.textContent = isPro ? "🧠 Pro" : "⚡ Flash";
  btn.style.opacity = "1";
  btn.title = isPro ? "当前: Pro（更强）\n点击切换到 Flash" : "当前: Flash（更快）\n点击切换到 Pro";
  document.getElementById("statusBar").textContent = isPro ? "🧠 已切换到 Pro 模型（更强）" : "⚡ 已切换到 Flash 模型（更快）";
  saveSettingsToMemory();
  localStorage.setItem("vbc_model", chatModel);
}

// === Web Search ===
let webSearchEnabled = false;
function toggleWebSearch() {
  webSearchEnabled = !webSearchEnabled;
  const btn = document.getElementById("webSearchBtn");
  btn.textContent = webSearchEnabled ? "🔍 联网:开" : "🔍 联网:关";
  btn.style.opacity = webSearchEnabled ? "1" : "0.5";
  saveSettingsToMemory();
  localStorage.setItem("vbc_websearch", webSearchEnabled ? "1" : "0");
}

function getWebSearchTool() {
  if (!webSearchEnabled) return [];
  return [{ type: "web_search" }];
}
let peekCanvas = null;

async function toggleScreenPeek() {
  if (peekEnabled) {
    stopScreenPeek();
  } else {
    await startScreenPeek();
  }
}

async function startScreenPeek() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1280, height: 720, frameRate: 1 }
    });
    screenVideo = document.createElement("video");
    screenVideo.srcObject = screenStream;
    screenVideo.muted = true;
    await screenVideo.play();
    peekCanvas = document.createElement("canvas");

    peekEnabled = true;
    const btn = document.getElementById("peekBtn");
    btn.textContent = "👀 视监:开";
    btn.style.opacity = "1";

    screenStream.getVideoTracks()[0].onended = () => stopScreenPeek();
  } catch(e) {
    console.warn("Screen share failed:", e);
  }
}

function stopScreenPeek() {
  peekEnabled = false;
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  if (screenVideo) { screenVideo.pause(); screenVideo = null; }
  const btn = document.getElementById("peekBtn");
  btn.textContent = "👀 视监:关";
  btn.style.opacity = "0.5";
}

function captureScreen() {
  if (!screenVideo || !peekCanvas) return null;
  const vw = screenVideo.videoWidth, vh = screenVideo.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, 800 / Math.max(vw, vh));
  peekCanvas.width = Math.floor(vw * scale);
  peekCanvas.height = Math.floor(vh * scale);
  const ctx = peekCanvas.getContext("2d");
  ctx.drawImage(screenVideo, 0, 0, peekCanvas.width, peekCanvas.height);
  return peekCanvas.toDataURL("image/jpeg", 0.6);
}

// Show screenshot thumbnail in chat
function appendScreenshotBubble(dataUrl) {
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row bot";
  row.innerHTML = `
    <div class="bubble bot" style="padding:8px">
    <div class="peek-label">👀 【角色称呼代词】偷看了你的屏幕：</div>
    <img class="peek-screenshot" src="${dataUrl}" onclick="window.open(this.src,'_blank')" />
  </div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

async function appendScreenshotFromDB(peekId) {
  const blob = await AudioDB.load(peekId);
  if (!blob) {
    const area = document.getElementById("chatArea");
    const row = document.createElement("div");
    row.className = "msg-row bot";
    row.innerHTML = `<div class="bubble bot" style="padding:8px">
      <div class="peek-label">👀 【角色称呼代词】偷看了你的屏幕（图片已过期）</div>
    </div>`;
    area.appendChild(row);
    return;
  }
  const url = URL.createObjectURL(blob);
  appendScreenshotBubble(url);
}

// Peek and react — called by proactive system or user request
async function peekAndReact(userAsked) {
  if (!peekEnabled || !mimoApiKey) return false;
  const dataUrl = captureScreen();
  if (!dataUrl) { return false; }
  const base64 = dataUrl.split(",")[1];

  // Show screenshot in chat
  const empty = document.getElementById("emptyState");
  if (empty) empty.remove();
  appendScreenshotBubble(dataUrl);
  // Save screenshot to IndexedDB (not localStorage — much more space)
  const peekId = "peek_" + Date.now();
  const peekBlob = await fetch(dataUrl).then(r => r.blob());
  await AudioDB.save(peekId, peekBlob);
  chatMessages.push({ role: "peek", peekId, time: Date.now() });
  saveChatHistory();

  const peekPrompt = userAsked
    ? `[【用户称呼代词】让你看【用户称呼代词的所有格】的屏幕。截图已附上。]
自然地对你看到的内容做出反应。像【角色身份】一样评论，不要像图像分析器。1-2条消息。`
    : `[你偷偷瞄了一眼【用户称呼代词的所有格】的屏幕，想看看【用户称呼代词】在干什么。截图已附上。]
像偷看被发现/主动偷看的【角色身份】一样反应。可以假装不小心看到的，也可以大方承认在看。
- 在跟别人聊天 → 【角色看到用户跟别人聊天时的反应描述，如：吃醋】！
- 在工作/学习 → 【角色看到用户工作学习时的反应描述，如：心疼或撒娇】
- 在逛淘宝 → 好奇问在买什么
- 在看视频 → 凑过来一起看
- 保持简短自然，1-2条消息。`;

  try {
    const apiMsgs = [
      ...conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + base64 } },
          { type: "text", text: peekPrompt }
        ]
      }
    ];

    // === Streaming + Parallel TTS ===
    const ttsPromisesMap = new Map();
    let detectedCount = 0;
    let ttsStartedCount = 0;
    let cachedParsedMsgs = [];
    function ensureTTS(index, english) {
      if (ttsPromisesMap.has(index)) return;
      ttsPromisesMap.set(index, fetchTTSForMessage(english, index));
    }

    const rawText = await callMiMoAPIStream({
      system: await buildSystemWithRecall("看屏幕"),
      messages: apiMsgs,
      max_tokens: 500,
      onChunk: (accumulated) => {
        cachedParsedMsgs = extractCompleteMessages(accumulated);
        detectedCount = Math.max(detectedCount, cachedParsedMsgs.length);

        // Early TTS: fire as soon as english field is closed in stream
        const readyEnglish = extractReadyEnglish(accumulated);
        for (let i = ttsStartedCount; i < readyEnglish.length; i++) {
          ensureTTS(i, readyEnglish[i]);
        }
        ttsStartedCount = Math.max(ttsStartedCount, readyEnglish.length);
      }
    });
    // Reuse cached messages from streaming if available, skip re-parsing
    const messages = cachedParsedMsgs.length > 0
      ? filterParsedMessages(cachedParsedMsgs)
      : parseMiMoResponse(rawText);

    // Ensure all TTS jobs are started
    for (let i = 0; i < messages.length; i++) {
      ensureTTS(i, messages[i].english);
    }

    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);

    await showMultipleMessages(messages, ttsPromisesMap);
    lastMessageTime = Date.now();
    return true;
  } catch(err) {
    console.warn("Screen peek error:", err);
    return false;
  }
}

// Detect if user is asking 【角色身份】 to look at screen
function isAskingToLook(text) {
  const keywords = ["看看我", "看我", "偷看", "视监", "看一下我", "看下我",
    "看我桌面", "看我屏幕", "看看我在", "你看到", "能看到", "看到了吗",
    "瞄一眼", "瞅一眼", "看一眼", "你看看",
    "截图", "截个图", "截屏", "看屏幕", "屏幕截图", "看看屏幕",
    "你看我在干嘛", "我在干嘛", "看看我在干什么", "看看我干嘛",
    "我在干啥", "看看我在干啥", "我在做什么", "猜猜我在"];
  return keywords.some(k => text.includes(k));
}


// === Avatar & Name Customization ===
let customAvatarUrl = null;
let pendingAvatarUrl = null;

function openAvatarEditor() {
  const editor = document.getElementById("avatarEditor");
  const preview = document.getElementById("avatarPreview");
  const nameInput = document.getElementById("avatarNameInput");
  
  // Set current values
  nameInput.value = document.getElementById("headerName").textContent;
  if (customAvatarUrl) {
    preview.innerHTML = `<img src="${customAvatarUrl}" />`;
  } else {
    preview.innerHTML = "♡";
  }
  pendingAvatarUrl = customAvatarUrl;
  editor.classList.add("visible");
}

function closeAvatarEditor() {
  document.getElementById("avatarEditor").classList.remove("visible");
  pendingAvatarUrl = null;
}

function handleAvatarUpload(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    // Auto-crop to square center
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      
      // Center crop
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      
      pendingAvatarUrl = canvas.toDataURL("image/jpeg", 0.85);
      document.getElementById("avatarPreview").innerHTML = `<img src="${pendingAvatarUrl}" />`;
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function resetAvatar() {
  pendingAvatarUrl = null;
  document.getElementById("avatarPreview").innerHTML = "♡";
  document.getElementById("avatarNameInput").value = "【角色默认显示名称】";
}

async function saveAvatarSettings() {
  const name = document.getElementById("avatarNameInput").value.trim() || "【角色默认显示名称】";
  
  // Update header
  document.getElementById("headerName").textContent = name;
  customAvatarUrl = pendingAvatarUrl;
  const avatar = document.getElementById("headerAvatar");
  if (customAvatarUrl) {
    avatar.innerHTML = `<img src="${customAvatarUrl}" />`;
  } else {
    avatar.innerHTML = "♡";
  }
  
  // Save to memory library folder
  if (memoryEnabled && memoryDirHandle) {
    try {
      const perm = await memoryDirHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        // Save name
        const nameFile = await memoryDirHandle.getFileHandle("custom-name.txt", { create: true });
        const nw = await nameFile.createWritable();
        await nw.write(name);
        await nw.close();
        
        // Save avatar image
        if (customAvatarUrl) {
          const blob = await fetch(customAvatarUrl).then(r => r.blob());
          const imgFile = await memoryDirHandle.getFileHandle("custom-avatar.jpg", { create: true });
          const iw = await imgFile.createWritable();
          await iw.write(blob);
          await iw.close();
        } else {
          // Remove avatar file if reset to default
          try { await memoryDirHandle.removeEntry("custom-avatar.jpg"); } catch(e) {}
        }
      }
    } catch(e) { console.warn("Save avatar to memory error:", e); }
  }
  
  syncCallPageAvatar();
  closeAvatarEditor();
}

async function restoreAvatarSettings() {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    
    // Restore name
    try {
      const nameFile = await memoryDirHandle.getFileHandle("custom-name.txt");
      const f = await nameFile.getFile();
      const name = await f.text();
      if (name) document.getElementById("headerName").textContent = name;
    } catch(e) {} // file doesn't exist = default name
    
    // Restore avatar
    try {
      const imgFile = await memoryDirHandle.getFileHandle("custom-avatar.jpg");
      const f = await imgFile.getFile();
      customAvatarUrl = URL.createObjectURL(f);
      document.getElementById("headerAvatar").innerHTML = `<img src="${customAvatarUrl}" />`;
    } catch(e) {} // file doesn't exist = default avatar
    syncCallPageAvatar();
  } catch(e) { console.warn("Restore avatar error:", e); }
}

// === Theme ===
function toggleThemePicker() {
  document.getElementById("themePicker").classList.toggle("visible");
}

function setTheme(theme) {
  if (theme === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  // Update active dot
  document.querySelectorAll(".theme-dot").forEach(d => d.classList.remove("active"));
  const dot = document.getElementById("dot-" + theme);
  if (dot) dot.classList.add("active");
  // Save preference to memory library
  saveSettingsToMemory();
  // Also keep localStorage as fallback (before memory lib is connected)
  localStorage.setItem("vbc_theme", theme);
  // Close picker
  document.getElementById("themePicker").classList.remove("visible");
}

// Close theme picker when clicking outside
document.addEventListener("click", (e) => {
  const picker = document.getElementById("themePicker");
  const btn = document.getElementById("themeBtn");
  if (picker && !picker.contains(e.target) && e.target !== btn) {
    picker.classList.remove("visible");
  }
});

// === Init ===
AudioDB.init().catch(e => console.warn("AudioDB init failed:", e));
loadKeys();
tryRestoreMemoryHandle();

// Restore theme
const savedTheme = localStorage.getItem("vbc_theme") || "default";
setTheme(savedTheme);

// Avatar & name restored from memory library via tryRestoreMemoryHandle

// Restore voice auto-play preference
try {
  if (localStorage.getItem("vbc_voice_autoplay") === "1") {
    voiceAutoPlayUser = true;
    const vap = document.getElementById("voiceAutoPlayToggle");
    if (vap) { vap.textContent = "🔊 自动播放:开"; vap.style.borderColor = "var(--accent)"; vap.style.color = "var(--accent)"; }
  }
  // Restore music volume
  const savedVol = localStorage.getItem("vbc_music_volume");
  if (savedVol) { musicVolume = parseInt(savedVol) / 100; const vs = document.getElementById("mpVol"); if (vs) vs.value = savedVol; }
} catch(e) {}

// Auto-save when page closes or hides
window.addEventListener("beforeunload", () => {
  finalizeAndSaveMusicSession();
  saveChatHistory();
  if (memoryEnabled && memoryDirHandle) saveToMemory();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    finalizeAndSaveMusicSession();
    saveChatHistory();
    if (memoryEnabled && memoryDirHandle) saveToMemory();
  }
});

// Detect STT support and show hint
(function() {
  const el = document.getElementById("sttStatus");
  if (mimoInput.value.trim()) {
    el.innerHTML = '🟢 <span style="color:#4a8">已填写，语音识别将使用 MiMo ASR</span>';
  } else {
    el.innerHTML = '🟡 <span style="color:#c4956a">未填写时语音消息仍可录制播放，但文字识别和语音通话需要此项</span>';
  }
  mimoInput.addEventListener("input", () => {
    if (mimoInput.value.trim()) {
      el.innerHTML = '🟢 <span style="color:#4a8">已填写，语音识别将使用 MiMo ASR</span>';
    } else {
      el.innerHTML = '🟡 <span style="color:#c4956a">未填写时语音消息仍可录制播放，但文字识别和语音通话需要此项</span>';
    }
  });
})();

// Detect Google AI key status
(function() {
  const el = document.getElementById("memoryStatus");
  const updateStatus = () => {
    if (googleInput.value.trim()) {
      el.innerHTML = '🟢 <span style="color:#4a8">已填写，长期语义记忆已启用</span>';
    } else {
      el.innerHTML = '🟡 <span style="color:#c4956a">未填写时仍可聊天，但没有跨对话的长期语义记忆</span>';
    }
  };
  updateStatus();
  googleInput.addEventListener("input", updateStatus);
})();
