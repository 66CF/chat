// === Chat Core ===
// Depends on: chat-lazyload.js, chat-upload.js, chat-tts.js, chat-batch.js, api.js, config.js

// Parse MiMo response: handles both array and single object
function parseMiMoResponse(rawText) {
  Debug.debug_log('parse', `parseMiMoResponse: ${rawText?.length || 0} chars`);
  const clean = (rawText || "").replace(/```json|```/g, "").trim();
  if (!clean) throw new Error("API 返回为空");
  let msgs;
  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) msgs = parsed;
    else if (parsed.english && parsed.chinese) msgs = [parsed];
    else throw new Error("Invalid format");
  } catch(e) {
    const engM = clean.match(/"english"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const chnM = clean.match(/"chinese"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (engM && chnM) {
      msgs = [{ english: engM[1].replace(/\\"/g,'"'), chinese: chnM[1].replace(/\\"/g,'"') }];
    } else {
      Debug.logParse('error', clean.slice(0, 300));
      throw new Error("回复解析失败: " + clean.slice(0, 300));
    }
  }
  // Filter: remove empty messages and emoji/kaomoji-only messages
  msgs = msgs.filter(m => {
    const eng = cleanTags(m.english || "").trim();
    if (!eng) return false; // completely empty after cleaning tags
    // Check if english is ONLY emoji (no letters, numbers, or punctuation)
    const withoutEmoji = eng.replace(/[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\s]/gu, "");
    if (!withoutEmoji) return false; // only emoji/spaces
    return true;
  });
  if (msgs.length === 0) msgs = [{ english: "hmm...", chinese: "嗯..." }];
  Debug.logParse('success', `${msgs.length}条消息`);
  return msgs;
}

// Apply the same filtering as parseMiMoResponse, but on already-parsed messages.
// Used to avoid re-parsing JSON when messages were already extracted during streaming.
function filterParsedMessages(msgs) {
  msgs = msgs.filter(m => {
    const eng = cleanTags(m.english || "").trim();
    if (!eng) return false;
    const withoutEmoji = eng.replace(/[\p{Emoji}\p{Emoji_Presentation}\p{Extended_Pictographic}\s]/gu, "");
    if (!withoutEmoji) return false;
    return true;
  });
  if (msgs.length === 0) msgs = [{ english: "hmm...", chinese: "嗯..." }];
  return msgs;
}

// Display multiple messages with sequential TTS
async function sendMessage() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  const hasImage = !!pendingImage;
  const hasFile = !!pendingFile;
  if ((!text && !hasImage && !hasFile) || isBusy) return;
  
  // Batch mode: stage message instead of sending immediately (works in all modes including roleplay)
  if (batchMode) {
    stageCurrentMessage();
    return;
  }

  // Roleplay mode intercept
  if (rpActive && text && !hasImage && !hasFile) {
    input.value = "";
    await sendRoleplayMessage(text);
    return;
  }
  
  isBusy = true;
  Debug.info('chat', `sendMessage: "${text?.slice(0, 50) || (hasImage ? '[图片]' : '[文件]')}" (image=${hasImage}, file=${hasFile})`);

  const imageData = pendingImage ? { ...pendingImage } : null;
  const fileData = pendingFile ? { ...pendingFile } : null;
  const replyData = pendingReply ? { ...pendingReply } : null;
  if (hasImage) clearImagePreview();
  if (hasFile) clearFilePreview();
  clearReply();

  input.value = "";
  const empty = document.getElementById("emptyState");
  if (empty) empty.remove();
  lastMessageTime = Date.now();

  // Build reply context string for API
  let replyContext = "";
  if (replyData) {
    const qRole = replyData.role === "user" ? "我" : "你";
    replyContext = `[↩${qRole}:"${replyData.text.slice(0,60)}"] `;
  }

  // Display message in chat
  if (imageData) {
    await appendImageMessage(text, imageData.dataUrl, true);
  } else if (!fileData) {
    appendMessage("user", text, true, undefined, replyData);
  }
  setLoading(true);

  try {
    document.getElementById("statusBar").textContent = webSearchEnabled ? "正在联网搜索..." : "正在思考...";

    // Check if user is asking 【角色身份】 to look at screen
    if (!hasImage && peekEnabled && isAskingToLook(text)) {
      conversationHistory.push({ role: "user", content: text });
      imprintLogTurn("user", text);
      setLoading(false);
      await peekAndReact(true);
      lastMessageTime = Date.now();
      scheduleProactiveMessage(3);
      document.getElementById("statusBar").textContent = "在线 · 语音已连接";
      isBusy = false;
      return;
    }

    // Build API message — file, image, or text only
    if (fileData) {
      // Show file attachment in chat
      const displayText = text || "";
      const savedText = text || `[发了文件: ${fileData.name}]`;
      if (displayText) {
        appendMessage("user", displayText, false);
      } else {
        // Create bubble with only file tag, no text
        const area = document.getElementById("chatArea");
        const row = document.createElement("div");
        row.className = "msg-row user";
        row.innerHTML = `<div class="bubble user"></div><div class="msg-time">${formatMsgTime(Date.now())}</div>`;
        area.appendChild(row);
        area.scrollTop = area.scrollHeight;
      }
      // Save with file info
      chatMessages.push({ role: "user", text: savedText, fileName: fileData.name, time: Date.now(), quote: replyData || undefined });
      saveChatHistory();
      const area = document.getElementById("chatArea");
      const lastRow = area.lastElementChild;
      const bubble = lastRow.querySelector(".bubble");
      if (bubble) bubble.insertAdjacentHTML("afterbegin", `<div class="file-attach-tag">📄 ${escapeHtml(fileData.name)}</div>`);

      let apiContent;
      if (fileData.isDoc) {
        apiContent = [
          { type: "document", source: { type: "base64", media_type: fileData.mediaType || "application/pdf", data: fileData.base64 } },
          { type: "text", text: replyContext + (text || `[【用户称呼代词】发了一个文件: ${fileData.name}，请阅读并自然地回应]`) }
        ];
      } else {
        const filePrompt = `${replyContext}[【用户称呼代词】发了一个文件: ${fileData.name}]\n\n<file name="${fileData.name}">\n${sanitizeText(fileData.content).slice(0, 15000)}\n</file>\n\n${text || "请阅读这个文件并自然地回应，告诉【用户称呼代词】你看到了什么。"}`;
        apiContent = [{ type: "text", text: filePrompt }];
      }

      // Build system prompt BEFORE pushing to history
      const systemPrompt = await buildSystemWithRecall(text || fileData.name);

      conversationHistory.push({ role: "user", content: displayText || `[发了文件: ${fileData.name}]` });
      imprintLogTurn("user", `[发了文件: ${fileData.name}] ${text || ""}`);

    const rawText = await callMiMoAPI({
      system: systemPrompt,
      messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
      max_tokens: (currentGame && currentGame.type === "story_relay") ? 128000 : 128000,
      tools: getWebSearchTool()
    });
      const messages = parseMiMoResponse(rawText);
      conversationHistory.push({ role: "assistant", content: rawText });
      imprintLogTurn("assistant", rawText);

      document.getElementById("statusBar").textContent = "正在生成语音...";
      setLoading(false);
      await showMultipleMessages(messages);
      lastMessageTime = Date.now();
      scheduleProactiveMessage(3);
      document.getElementById("statusBar").textContent = "在线 · 语音已连接";

    } else if (imageData) {
      const content = [
        { type: "image_url", image_url: { url: "data:" + imageData.mediaType + ";base64," + imageData.base64 } },
        { type: "text", text: replyContext + (text || "[【用户称呼代词】发了一张图片给你，看看是什么并自然地反应]") }
      ];

      // Build system prompt BEFORE pushing to history
      const systemPrompt = await buildSystemWithRecall(text || "图片");

      conversationHistory.push({ role: "user", content: text || "[图片]" });
      imprintLogTurn("user", text || "[发了一张图片]");

      // Send with image
      const rawText2 = await callMiMoAPI({
        system: systemPrompt,
        messages: [...conversationHistory.slice(-20, -1).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())), { role: "user", content }],
        max_tokens: 128000,
        tools: getWebSearchTool()
      });
      const messages = parseMiMoResponse(rawText2);
      conversationHistory.push({ role: "assistant", content: rawText2 });
      imprintLogTurn("assistant", rawText2);

      document.getElementById("statusBar").textContent = "正在生成语音...";
      setLoading(false);
      await showMultipleMessages(messages);
      lastMessageTime = Date.now();
      scheduleProactiveMessage(3);
      document.getElementById("statusBar").textContent = "在线 · 语音已连接";

    } else {
      // Build system prompt with memory recall BEFORE pushing to history
      // (so searchRawHistory won't match the current message against itself)
      const apiText = replyContext + text;
      const systemPrompt = await buildSystemWithRecall(apiText);

      conversationHistory.push({ role: "user", content: apiText });
      imprintLogTurn("user", apiText);

      // === Streaming Pipeline: parse → TTS → display one by one ===
      // Each message is displayed & played as soon as its TTS completes,
      // without waiting for the entire response to finish.
      const proc = createStreamMessageProcessor();
      let completedMsgCount = 0;
      let earlyTTSDone = 0;
      const ttsMap = {};  // index → Promise

      function fireTTS(index, english) {
        if (!ttsMap[index]) ttsMap[index] = fetchTTSForMessage(english, index);
        return ttsMap[index];
      }

      // Run stream + display loop in parallel via Promise.all
      const [, rawText] = await Promise.all([
        proc.finished,
        (async () => {
          const rawText = await callMiMoAPIStream({
            system: systemPrompt,
            messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
            max_tokens: (currentGame && currentGame.type === "story_relay") ? 128000 : 128000,
            tools: getWebSearchTool(),
            onChunk: (accumulated) => {
              // Detect new complete messages → fire TTS + enqueue for display
              const msgs = extractCompleteMessages(accumulated);
              for (let i = completedMsgCount; i < msgs.length; i++) {
                const m = msgs[i];
                const p = fireTTS(i, m.english);
                proc.enqueue(m, p);
                completedMsgCount++;
              }

              // Also fire TTS early for english fields (before full JSON arrives)
              const readyEnglish = extractReadyEnglish(accumulated);
              for (let i = earlyTTSDone; i < readyEnglish.length; i++) {
                fireTTS(i, readyEnglish[i]);
                earlyTTSDone++;
              }

              document.getElementById("statusBar").textContent =
                `正在思考... (${completedMsgCount}条已解析)`;
            }
          });

          // Catch any messages not detected during streaming (fallback)
          const finalMsgs = parseMiMoResponse(rawText);
          for (let i = completedMsgCount; i < finalMsgs.length; i++) {
            const m = finalMsgs[i];
            const p = fireTTS(i, m.english);
            proc.enqueue(m, p);
            completedMsgCount++;
          }

          proc.done();  // signal display loop to finish
          return rawText;
        })()
      ]);

      conversationHistory.push({ role: "assistant", content: rawText });
      imprintLogTurn("assistant", rawText);

      lastMessageTime = Date.now();
      scheduleProactiveMessage(3);
      document.getElementById("statusBar").textContent = "在线 · 语音已连接";
    }

  } catch (err) {
    console.error(err);
    Debug.error('chat', `sendMessage 失败: ${err.message}`, err.stack);
    setLoading(false);
    showError(err.message);
    document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  }

  isBusy = false;
  input.focus();
}

function deleteThisMessage(btn) {
  const row = btn.closest(".msg-row");
  if (!row || !confirm("删除这条消息？")) return;
  const area = document.getElementById("chatArea");
  const allRows = Array.from(area.querySelectorAll(".msg-row"));
  const idx = allRows.indexOf(row);
  
  if (idx >= 0 && idx < chatMessages.length) {
    const msg = chatMessages[idx];
    // Clean up associated blobs from IndexedDB
    if (msg.audioId) AudioDB.delete(msg.audioId).catch(()=>{});
    if (msg.voiceAudioId) AudioDB.delete(msg.voiceAudioId).catch(()=>{});
    if (msg.peekId) AudioDB.delete(msg.peekId).catch(()=>{});
    if (msg.imgId) AudioDB.delete(msg.imgId).catch(()=>{});
    
    chatMessages.splice(idx, 1);
    saveChatHistory();
  }
  
  row.remove();
}

// Auto-inject action buttons (reply + delete) below timestamp in every msg-row
function injectMsgActions(row) {
  if (row.querySelector(".msg-actions")) return; // already has
  const time = row.querySelector(".msg-time");
  if (!time) return;
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  actions.innerHTML = '<button class="msg-reply-btn" onclick="replyToMessage(this)" title="引用回复">↩</button><button class="msg-delete" onclick="deleteThisMessage(this)" title="删除">✕</button>';
  time.insertAdjacentElement("afterend", actions);
}

// Observe chatArea for new msg-rows
const _chatObserver = new MutationObserver(muts => {
  for (const m of muts) {
    for (const node of m.addedNodes) {
      if (node.nodeType === 1) {
        if (node.classList?.contains("msg-row")) injectMsgActions(node);
        // Also check children (e.g. if a wrapper was added)
        node.querySelectorAll?.(".msg-row")?.forEach(injectMsgActions);
      }
    }
  }
});
_chatObserver.observe(document.getElementById("chatArea"), { childList: true, subtree: true });

// Inject into any existing rows (restored messages)
document.querySelectorAll("#chatArea .msg-row").forEach(injectMsgActions);

function appendMessage(role, text, save, time, quoteData) {
  const ts = time || Date.now();
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row " + role;
  const quoteHtml = quoteData ? buildQuoteBlockHtml(quoteData) : "";
  row.innerHTML = `<div class="bubble ${role}">${quoteHtml}${escapeHtml(text)}</div><div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  if (save) {
    chatMessages.push({ role: "user", text, time: ts, quote: quoteData || undefined });
    saveChatHistory();
  }
}

function appendBotMessage(english, chinese, audioUrl, save, audioId, time, quoteData) {
  const ts = time || Date.now();
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row bot";

  const hasAudio = !!(audioUrl || audioId);
  const audioAttr = audioUrl ? ` data-audio-url="${escapeHtml(audioUrl)}"` : "";
  const idAttr = audioId ? ` data-audio-id="${audioId}"` : "";
  const bubbleClass = hasAudio ? "bubble bot bubble-audio" : "bubble bot";

  const quoteHtml = quoteData ? buildQuoteBlockHtml(quoteData) : "";

  row.innerHTML = `<div class="${bubbleClass}"${audioAttr}${idAttr}>${quoteHtml}<div class="english">${escapeHtml(english)}</div><div class="chinese">${escapeHtml(chinese)}</div></div><div class="msg-time">${formatMsgTime(ts)}</div>`;

  if (hasAudio) {
    const bubble = row.querySelector(".bubble");
    bubble.addEventListener("click", () => handleBubbleReplay(bubble));
  }
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  if (save) {
    chatMessages.push({ role: "assistant", english, chinese, audioId: audioId || null, time: ts, quote: quoteData || undefined });
    saveChatHistory();
  }
}

// === Reply / Quote Feature ===
let pendingReply = null; // { role, text, index }

function buildQuoteBlockHtml(quoteData) {
  if (!quoteData) return "";
  const roleLabel = quoteData.role === "user" ? "你" : (document.getElementById("headerName").textContent || "【角色称呼代词简称】");
  const previewText = (quoteData.text || "").slice(0, 80) + (quoteData.text && quoteData.text.length > 80 ? "…" : "");
  return `<div class="quote-block"><div class="quote-role">${escapeHtml(roleLabel)}</div>${escapeHtml(previewText)}</div>`;
}

function replyToMessage(btn) {
  const row = btn.closest(".msg-row");
  if (!row) return;
  const area = document.getElementById("chatArea");
  const allRows = Array.from(area.querySelectorAll(".msg-row"));
  const idx = allRows.indexOf(row);
  
  let role, text;
  if (row.classList.contains("user")) {
    role = "user";
    const bubble = row.querySelector(".bubble.user");
    // Get text without quote block
    const cloned = bubble.cloneNode(true);
    const qb = cloned.querySelector(".quote-block");
    if (qb) qb.remove();
    text = cloned.textContent.trim();
  } else {
    role = "bot";
    const eng = row.querySelector(".english");
    const chn = row.querySelector(".chinese");
    text = (chn ? chn.textContent : "") || (eng ? eng.textContent : "") || "…";
  }
  
  pendingReply = { role, text, index: idx };
  
  // Show preview bar
  const bar = document.getElementById("replyPreviewBar");
  const content = document.getElementById("replyPreviewContent");
  const roleLabel = role === "user" ? "你" : (document.getElementById("headerName").textContent || "【角色称呼代词简称】");
  content.innerHTML = `<span class="reply-role-tag">${escapeHtml(roleLabel)}</span>${escapeHtml(text.slice(0, 60))}`;
  bar.style.display = "flex";
  
  document.getElementById("chatInput").focus();
}

function clearReply() {
  pendingReply = null;
  document.getElementById("replyPreviewBar").style.display = "none";
}
