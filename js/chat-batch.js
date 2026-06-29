// === Multi-message Batch Mode ===
let batchMode = false;
let stagedMessages = []; // { text, quoteData, imageData, fileData }



function toggleBatchMode() {
  batchMode = !batchMode;
  const btn = document.getElementById("batchModeBtn");
  if (batchMode) {
    btn.style.borderColor = "var(--accent)";
    btn.style.color = "var(--accent)";
    btn.style.background = "var(--accent-glow)";
    btn.title = "连续发送模式：开";
    showToast("📌 连续发送模式已开启\n可以连续发多条消息，最后点「发送全部」", 1800);
  } else {
    btn.style.borderColor = "";
    btn.style.color = "";
    btn.style.background = "";
    btn.title = "连续发送模式";
    showToast("📌 连续发送模式已关闭");
    // If there are staged messages when turning off, send them
    if (stagedMessages.length > 0) {
      sendAllStaged();
    }
  }
}

function renderStagedBar() {
  const bar = document.getElementById("stagedBar");
  const list = document.getElementById("stagedMsgList");
  const count = document.getElementById("stagedCount");
  
  if (stagedMessages.length === 0) {
    bar.style.display = "none";
    return;
  }
  
  bar.style.display = "flex";
  count.textContent = stagedMessages.length;
  list.innerHTML = stagedMessages.map((m, i) => {
    const preview = m.imageData ? "🖼️ " + (m.text || "图片") : m.fileData ? "📄 " + (m.text || m.fileData.name) : m.text;
    const quoteTag = m.quoteData ? "↩ " : "";
    return `<div class="staged-msg-chip"><span class="staged-text">${quoteTag}${escapeHtml(preview.slice(0, 50))}</span><button class="staged-remove" onclick="removeStagedMsg(${i})">✕</button></div>`;
  }).join("");
}

function removeStagedMsg(idx) {
  stagedMessages.splice(idx, 1);
  renderStagedBar();
  if (stagedMessages.length === 0 && !batchMode) {
    document.getElementById("stagedBar").style.display = "none";
  }
}

function stageCurrentMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  const hasImage = !!pendingImage;
  const hasFile = !!pendingFile;
  if (!text && !hasImage && !hasFile) return;
  
  const staged = {
    text: text,
    quoteData: pendingReply ? { ...pendingReply } : null,
    imageData: hasImage ? { ...pendingImage } : null,
    fileData: hasFile ? { ...pendingFile } : null
  };
  
  stagedMessages.push(staged);
  input.value = "";
  input.style.height = "auto";
  if (hasImage) clearImagePreview();
  if (hasFile) clearFilePreview();
  clearReply();
  renderStagedBar();
  if (typeof updateSendButtonIcon === "function") updateSendButtonIcon();
}

async function sendAllStaged() {
  if (stagedMessages.length === 0 || isBusy) return;
  
  // Also stage current input if any
  const input = document.getElementById("chatInput");
  if (input.value.trim() || pendingImage || pendingFile) {
    stageCurrentMessage();
  }
  
  if (stagedMessages.length === 0) return;
  
  // Roleplay mode: combine all staged texts and send as one roleplay message
  if (rpActive) {
    const combinedText = stagedMessages.filter(m => m.text).map(m => m.text).join("\n");
    stagedMessages = [];
    renderStagedBar();
    if (combinedText.trim()) {
      await sendRoleplayMessage(combinedText);
    }
    return;
  }

  const messagesToSend = [...stagedMessages];
  stagedMessages = [];
  renderStagedBar();
  
  isBusy = true;
  const empty = document.getElementById("emptyState");
  if (empty) empty.remove();
  lastMessageTime = Date.now();
  
  // Display all user messages in chat
  const combinedTexts = [];
  for (const m of messagesToSend) {
    if (m.imageData) {
      await appendImageMessage(m.text || "", m.imageData.dataUrl, true);
      combinedTexts.push(m.text || "[图片]");
    } else if (m.fileData) {
      const displayText = m.text || "";
      if (displayText) {
        appendMessage("user", displayText, false, undefined, m.quoteData);
      } else {
        const area = document.getElementById("chatArea");
        const row = document.createElement("div");
        row.className = "msg-row user";
        row.innerHTML = `<div class="bubble user"></div><div class="msg-time">${formatMsgTime(Date.now())}</div>`;
        area.appendChild(row);
        area.scrollTop = area.scrollHeight;
      }
      chatMessages.push({ role: "user", text: m.text || `[发了文件: ${m.fileData.name}]`, fileName: m.fileData.name, time: Date.now(), quote: m.quoteData || undefined });
      saveChatHistory();
      const area2 = document.getElementById("chatArea");
      const lastRow = area2.lastElementChild;
      const bubble = lastRow.querySelector(".bubble");
      if (bubble) bubble.insertAdjacentHTML("afterbegin", `<div class="file-attach-tag">📄 ${escapeHtml(m.fileData.name)}</div>`);
      combinedTexts.push(`[发了文件: ${m.fileData.name}] ${m.text || ""}`);
    } else {
      appendMessage("user", m.text, true, undefined, m.quoteData);
      let t = m.text;
      if (m.quoteData) {
        const qRole = m.quoteData.role === "user" ? "我" : "你";
        t = `[↩${qRole}:"${m.quoteData.text.slice(0,60)}"] ${t}`;
      }
      combinedTexts.push(t);
    }
  }
  
  setLoading(true);
    
  try {
    document.getElementById("statusBar").textContent = webSearchEnabled ? "正在联网搜索..." : "正在思考...";
      
    // Combine all texts for API
    const combinedText = combinedTexts.join("\n");
    const systemPrompt = await prepareBotContext(combinedText, combinedText);
      
    // === Streaming Pipeline: parse → TTS → display one by one ===
    // 使用共享的 streamWithTTS 函数
    const { rawText } = await streamWithTTS({
      system: systemPrompt,
      messages: getRecentMessages(),
      max_tokens: 8192,
      tools: getWebSearchTool(),
      onProgress: (completedMsgCount) => {
        document.getElementById("statusBar").textContent =
          `正在思考... (${completedMsgCount}条已解析)`;
      }
    });

    // Streaming handles display internally; just save reply
    await handleBotReply(rawText, { skipDisplay: true });
      
    lastMessageTime = Date.now();
    scheduleProactiveMessage(3);
    document.getElementById("statusBar").textContent = "在线 · 语音已连接";
      
  } catch (err) {
    ErrorHandler.handle(err, 'sendAllStaged', { showToast: true });
    setLoading(false);
    document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  }
  
  isBusy = false;
  document.getElementById("chatInput").focus();
}

function setLoading(show) {
  const existing = document.getElementById("loadingBubble");
  if (existing) existing.remove();

  if (show) {
    const area = document.getElementById("chatArea");
    const row = document.createElement("div");
    row.className = "msg-row bot";
    row.id = "loadingBubble";
    row.innerHTML = `<div class="loading-bubble">
      <span class="dot">·</span><span class="dot">·</span><span class="dot">·</span>
    </div>`;
    area.appendChild(row);
    area.scrollTop = area.scrollHeight;
  }
}
