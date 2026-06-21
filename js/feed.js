function toggleFeedPanel() {
  const panel = document.getElementById("feedPanel");
  panel.classList.toggle("open");
  document.getElementById("feedOverlay").classList.toggle("open");
  // Clear selection when closing
  if (!panel.classList.contains("open")) {
    clearFeedSelection();
  }
}

let _selectedFeedEmoji = "";
let _selectedFeedName = "";

function selectFood(emoji, foodName) {
  _selectedFeedEmoji = emoji;
  _selectedFeedName = foodName;
  document.getElementById("feedSelEmoji").textContent = emoji;
  document.getElementById("feedSelName").textContent = foodName;
  document.getElementById("feedInputBar").style.display = "";
  document.getElementById("feedTextInput").value = "";
  document.getElementById("feedTextInput").focus();
  // Highlight selected item
  document.querySelectorAll(".feed-item").forEach(el => el.style.borderColor = "");
}

function clearFeedSelection() {
  _selectedFeedEmoji = "";
  _selectedFeedName = "";
  document.getElementById("feedInputBar").style.display = "none";
  document.querySelectorAll(".feed-item").forEach(el => el.style.borderColor = "");
}

function sendFeedWithText() {
  if (!_selectedFeedEmoji) return;
  const text = document.getElementById("feedTextInput").value.trim();
  document.getElementById("feedInputBar").style.display = "none";
  feedBot(_selectedFeedEmoji, _selectedFeedName, text);
  _selectedFeedEmoji = "";
  _selectedFeedName = "";
}

async function feedBot(emoji, foodName, extraText) {
  // Pop animation
  const pop = document.createElement("div");
  pop.className = "feed-reaction";
  pop.textContent = emoji;
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 1000);

  // Close panel
  toggleFeedPanel();

  if (isBusy) return;
  isBusy = true;

  // Show in chat
  const ts = Date.now();
  const area = document.getElementById("chatArea");
  const emptyState = document.getElementById("emptyState");
  if (emptyState) emptyState.remove();

  const row = document.createElement("div");
  row.className = "msg-row user";
  const extraHtml = extraText ? `<div style="margin-top:6px;font-size:14px;color:var(--user-bubble-text)">${escapeHtml(extraText)}</div>` : "";
  row.innerHTML = `
    <div class="bubble user" style="text-align:center;font-size:14px">
      <span style="font-size:36px">${emoji}</span><br>
      <span style="color:var(--text-secondary)">喂了【角色称呼代词】${escapeHtml(foodName)}</span>${extraHtml}
    </div>
    <div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  chatMessages.push({ role: "user", text: `[喂食:${foodName}${emoji}]${extraText ? " " + extraText : ""}`, isFeed: true, time: ts });
  saveChatHistory();

  // Tell DeepSeek
  const feedMsg = extraText
    ? `[【用户称呼代词，大写首字母如：She/He】 opened the feeding panel and picked ${foodName}${emoji} to feed you, while saying: "${extraText}"] IMPORTANT: Reply with 2-4 separate JSON messages, NOT just one!`
    : `[【用户称呼代词，大写首字母】 opened the feeding panel and picked ${foodName}${emoji} to feed you] IMPORTANT: Reply with 2-4 separate JSON messages, NOT just one!`;
  conversationHistory.push({ role: "user", content: feedMsg });
  imprintLogTurn("user", `[喂食: ${foodName}]${extraText ? " " + extraText : ""}`);

  setLoading(true);
  document.getElementById("statusBar").textContent = "正在嚼...";

  try {
    const systemPrompt = await buildSystemWithRecall(feedMsg);
    const rawText = await callDeepSeekAPI({
      system: systemPrompt,
      messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
      max_tokens: 650
    });
    const messages = parseDeepSeekResponse(rawText);
    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);

    setLoading(false);
    await showMultipleMessages(messages);
    lastMessageTime = Date.now();
    scheduleProactiveMessage(3);
  } catch(e) {
    console.error("Feed error:", e);
    setLoading(false);
    appendBotMessage("mmm~", `好吃！${emoji}`, null, false);
  }

  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  isBusy = false;
}
