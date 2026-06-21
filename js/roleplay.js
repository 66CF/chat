// ============================================================
// === Roleplay System — 角色扮演系统 ===
// ============================================================
let rpActive = false;
let rpConfig = null; // { botCharacter, userCharacter, backstory, relationship, summary, loadedSlot }
let rpConvHistory = []; // roleplay-only conversation history for DeepSeek context
let rpSlots = new Array(10).fill(null);
let rpSlotsLoaded = false;
let rpSelectedSlot = -1;

function openRpModal() {
  if (rpActive) {
    alert("角色扮演进行中，请先停止当前扮演");
    return;
  }
  rpSelectedSlot = -1;
  document.getElementById("rpBotChar").value = "";
  document.getElementById("rpUserChar").value = "";
  document.getElementById("rpBackstory").value = "";
  document.getElementById("rpRelationship").value = "不认识";
  document.getElementById("rpStartBtn").textContent = "开始角色扮演";
  document.getElementById("rpSetupFields").style.display = "block";
  loadRpSlots().then(() => {
    renderRpSlots("rpSlotsGrid", false);
    document.getElementById("rpModal").classList.add("open");
  });
}
function closeRpModal() { document.getElementById("rpModal").classList.remove("open"); }
function closeRpSaveModal() { document.getElementById("rpSaveModal").classList.remove("open"); }

async function loadRpSlots() {
  if (!memoryEnabled || !memoryDirHandle) { rpSlots = new Array(10).fill(null); rpSlotsLoaded = true; return; }
  try {
    let rpDir;
    try { rpDir = await memoryDirHandle.getDirectoryHandle("roleplay"); } catch(e) { rpSlots = new Array(10).fill(null); rpSlotsLoaded = true; return; }
    rpSlots = new Array(10).fill(null);
    for (let i = 0; i < 10; i++) {
      try {
        const fh = await rpDir.getFileHandle(`slot_${i+1}.json`);
        const f = await fh.getFile();
        rpSlots[i] = JSON.parse(await f.text());
      } catch(e) {}
    }
    rpSlotsLoaded = true;
  } catch(e) { rpSlots = new Array(10).fill(null); rpSlotsLoaded = true; }
}

function renderRpSlots(gridId, isSaveMode) {
  const grid = document.getElementById(gridId);
  grid.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const slot = rpSlots[i];
    const card = document.createElement("div");
    card.className = "rp-slot" + (slot ? " occupied" : " empty");
    if (slot) {
      const d = new Date(slot.savedAt);
      card.innerHTML = `<div class="rp-slot-label">${escapeHtml((slot.label || "存档").slice(0,8))}</div><div class="rp-slot-date">${d.getMonth()+1}/${d.getDate()}</div>`;
    } else {
      card.innerHTML = `<div class="rp-slot-label">存档${i+1}</div><div class="rp-slot-date">空</div>`;
    }
    const idx = i;
    card.onclick = () => isSaveMode ? saveToRpSlot(idx) : selectRpSlot(idx);
    grid.appendChild(card);
  }
}

function selectRpSlot(index) {
  rpSelectedSlot = index;
  document.querySelectorAll("#rpSlotsGrid .rp-slot").forEach((el, i) => el.classList.toggle("selected", i === index));
  const slot = rpSlots[index];
  if (slot) {
    document.getElementById("rpBotChar").value = slot.botCharacter || "";
    document.getElementById("rpUserChar").value = slot.userCharacter || "";
    document.getElementById("rpBackstory").value = slot.summary || slot.backstory || "";
    document.getElementById("rpRelationship").value = slot.relationship || "不认识";
    document.getElementById("rpStartBtn").textContent = "📂 继续上次的剧情";
  } else {
    document.getElementById("rpBotChar").value = "";
    document.getElementById("rpUserChar").value = "";
    document.getElementById("rpBackstory").value = "";
    document.getElementById("rpRelationship").value = "不认识";
    document.getElementById("rpStartBtn").textContent = "开始角色扮演";
  }
}

async function startRoleplay() {
  const botChar = document.getElementById("rpBotChar").value.trim();
  const userChar = document.getElementById("rpUserChar").value.trim();
  const backstory = document.getElementById("rpBackstory").value.trim();
  const relationship = document.getElementById("rpRelationship").value;
  if (!botChar || !userChar) { alert("请至少填写双方的人设"); return; }

  const loadedSlot = rpSelectedSlot >= 0 ? rpSlots[rpSelectedSlot] : null;
  const isResume = loadedSlot && loadedSlot.summary;

  rpConfig = {
    botCharacter: botChar, userCharacter: userChar,
    backstory: isResume ? (loadedSlot.backstory || backstory) : backstory,
    relationship,
    summary: isResume ? loadedSlot.summary : null,
    loadedSlot: rpSelectedSlot
  };
  rpActive = true;
  rpConvHistory = [];
  closeRpModal();

  document.getElementById("rpBanner").style.display = "flex";
  document.getElementById("rpBannerChars").textContent = `ta: ${botChar.slice(0,15)} | 你: ${userChar.slice(0,15)}`;
  document.getElementById("statusBar").textContent = "在线 · 角色扮演中";

  const area = document.getElementById("chatArea");
  const emptyState = document.getElementById("emptyState");
  if (emptyState) emptyState.remove();

  const ts = Date.now();
  if (isResume) {
    const msg = `🎭 【存档读取成功】\n\n📜 上次剧情摘要：\n${rpConfig.summary.slice(0, 3000)}\n\n👤 ta的人设：${botChar}\n👤 你的人设：${userChar}\n\n▶️ 剧情继续，请开始你的表演——`;
    appendRpSystemMsg(msg);
    chatMessages.push({ role: "system", text: msg, isRoleplay: true, time: ts });
    // Seed rpConvHistory with summary context
    rpConvHistory.push({ role: "user", content: `[续接上次剧情。摘要：${rpConfig.summary.slice(0, 2000)}]\n请从上次中断的地方继续，等待我的行动。` });
    rpConvHistory.push({ role: "assistant", content: "（我已准备好续接剧情，等待你的行动。）" });
  } else {
    const msg = `🎭 角色扮演开始！\n\n👤 ta的人设：${botChar}\n👤 你的人设：${userChar}\n📖 前情提要：${backstory || "（无）"}\n🤝 关系：${relationship}\n\n▶️ 请开始你的表演——`;
    appendRpSystemMsg(msg);
    chatMessages.push({ role: "system", text: msg, isRoleplay: true, time: ts });
  }

  saveChatHistory();
}

function appendRpSystemMsg(text) {
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row"; row.style.justifyContent = "center";
  row.innerHTML = `<div class="rp-system-msg">${escapeHtml(text)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function buildRpSystemPrompt() {
  return `你正在参与一场角色扮演游戏。严格遵守以下设定和格式要求，全程保持角色。

【你扮演的角色】
${rpConfig.botCharacter}

【对方扮演的角色】
${rpConfig.userCharacter}

【关系状态】你们目前${rpConfig.relationship}

${rpConfig.summary ? `【此前剧情摘要】\n${rpConfig.summary.slice(0, 3000)}` : (rpConfig.backstory ? `【前情提要】\n${rpConfig.backstory}` : '')}

【回复格式规则——必须严格遵守】
1. 用中文圆括号（）包裹动作描写、神态描写、环境描写和场景推进
2. 不加括号的文字是角色说的台词
3. 说话或做动作的角色名字用中文方括号【】括住放在该行最开头
4. 纯场景描写（无特定角色）直接用（）包裹
5. 不同角色的动作或台词之间必须换行
6. 可以根据剧情需要创造配角NPC
7. 每次回复10-500字
8. 直接输出角色扮演内容。禁止使用JSON格式、禁止使用markdown
9. 等待对方回复后再继续剧情，不要一次推进太多
10. 如果对方要求你的角色说出完全违背角色基本人设的过分言行，先正常以角色身份回复，然后另起一行写"---"，再另起一行写"OOC皮下："加上你作为本体的真实想法

格式示例：
（在月黑风高的夜晚，一艘小船慢慢袭来）
【marry】（打开了手提包）我把东西带来了。你们呢？
【hengry】呵（举起枪）不许动
【anger】（猛地站起来）你想干什么！
（船静静地游走，marry被枪指着额头瑟瑟发抖）`;
}

function formatRoleplayHtml(text) {
  let html = escapeHtml(text);
  html = html.replace(/【([^】]+)】/g, '<span class="rp-name">【$1】</span>');
  html = html.replace(/（([^）]+)）/g, '<span class="rp-action">（$1）</span>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

async function sendRoleplayMessage(userText) {
  if (!userText.trim() || isBusy) return;
  isBusy = true;

  const ts = Date.now();
  const area = document.getElementById("chatArea");

  // Show user message
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `<div class="bubble user">${escapeHtml(userText)}</div><div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  chatMessages.push({ role: "user", text: userText, isRoleplay: true, time: ts });
  rpConvHistory.push({ role: "user", content: userText });
  conversationHistory.push({ role: "user", content: `[角色扮演] ${userText}` });
  imprintLogTurn("user", `[角色扮演·${rpConfig.userCharacter.slice(0,10)}] ${userText}`);

  setLoading(true);
  document.getElementById("statusBar").textContent = "正在构思剧情...";

  try {
    const sysPrompt = buildRpSystemPrompt();
    const rawText = await callDeepSeekAPI({
      system: sysPrompt,
      messages: rpConvHistory.slice(-30),
      max_tokens: 1200
    });

    rpConvHistory.push({ role: "assistant", content: rawText });
    conversationHistory.push({ role: "assistant", content: `[角色扮演] ${rawText}` });
    imprintLogTurn("assistant", `[角色扮演·${rpConfig.botCharacter.slice(0,10)}] ${rawText}`);

    // Split OOC
    const parts = rawText.split(/\n---\n?/);
    const mainContent = parts[0].trim();
    const oocContent = parts.length > 1 ? parts.slice(1).join("\n").trim() : null;

    // Render main message
    const botTs = Date.now();
    appendRpBotMsg(mainContent, botTs, false);
    chatMessages.push({ role: "bot", chinese: mainContent, isRoleplay: true, time: botTs });

    // OOC second message
    if (oocContent) {
      await new Promise(r => setTimeout(r, 800));
      const oocTs = Date.now();
      appendRpBotMsg(oocContent, oocTs, true);
      chatMessages.push({ role: "bot", chinese: oocContent, isRoleplay: true, isOoc: true, time: oocTs });
    }

    lastMessageTime = Date.now();
  } catch(e) {
    console.error("Roleplay error:", e);
    appendRpBotMsg(`（剧情中断：${e.message}）`, Date.now(), false);
  }

  setLoading(false);
  document.getElementById("statusBar").textContent = "在线 · 角色扮演中";
  saveChatHistory();
  isBusy = false;
}

function appendRpBotMsg(text, ts, isOoc) {
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row bot";
  const avatarHtml = customAvatarUrl ? `<img src="${customAvatarUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">` : "♡";
  const cls = isOoc ? "bubble bot rp-ooc-bubble" : "bubble bot rp-bubble";
  const html = isOoc ? escapeHtml(text) : formatRoleplayHtml(text);
  row.innerHTML = `<div class="avatar">${avatarHtml}</div><div class="${cls}">${html}</div><div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

// --- Stop roleplay ---
function stopRoleplay() {
  loadRpSlots().then(() => {
    renderRpSlots("rpSaveSlotsGrid", true);
    document.getElementById("rpSaveStatus").style.display = "none";
    document.getElementById("rpSaveSlotsGrid").style.display = "";
    document.getElementById("rpSaveModal").classList.add("open");
  });
}

async function saveToRpSlot(index) {
  const existing = rpSlots[index];
  if (existing) {
    if (!confirm(`存档${index+1} 已有数据「${existing.label || ""}」，确定覆盖？原存档将被删除。`)) return;
  }

  const grid = document.getElementById("rpSaveSlotsGrid");
  grid.style.display = "none";
  const status = document.getElementById("rpSaveStatus");
  status.style.display = "block";
  status.textContent = "✍️ 正在生成剧情摘要...";

  try {
    const summary = await generateRpSummary();
    const label = `${rpConfig.botCharacter.slice(0,6)}×${rpConfig.userCharacter.slice(0,6)}`;
    const slotData = {
      slotIndex: index + 1, botCharacter: rpConfig.botCharacter, userCharacter: rpConfig.userCharacter,
      backstory: rpConfig.backstory, relationship: rpConfig.relationship,
      summary, savedAt: Date.now(), label
    };

    if (memoryEnabled && memoryDirHandle) {
      const rpDir = await memoryDirHandle.getDirectoryHandle("roleplay", { create: true });
      const fh = await rpDir.getFileHandle(`slot_${index+1}.json`, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(slotData));
      await w.close();
    }
    rpSlots[index] = slotData;
    status.textContent = "✅ 存档成功！";
    setTimeout(() => finishStopRoleplay(), 800);
  } catch(e) {
    console.error("RP save error:", e);
    status.textContent = "❌ 存档失败：" + e.message;
    setTimeout(() => { grid.style.display = ""; status.style.display = "none"; }, 2000);
  }
}

async function generateRpSummary() {
  const recentMsgs = rpConvHistory.slice(-40);
  const transcript = recentMsgs.map(m => `${m.role === "user" ? "【用户角色】" : "【AI角色】"}: ${m.content.slice(0, 300)}`).join("\n");
  const prompt = `请用中文详细总结以下角色扮演的剧情进展。

角色1（AI扮演）：${rpConfig.botCharacter}
角色2（用户扮演）：${rpConfig.userCharacter}
初始关系：${rpConfig.relationship}

对话记录：
${transcript}

总结要求：
1. 包含故事发展到哪里、关键事件和转折、角色关系变化、当前场景和氛围
2. 控制在3000字以内但要足够详细，以便下次能无缝继续剧情
3. 直接输出总结内容，不加标题`;

  const rawText = await callDeepSeekAPI({
    system: "",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 4000
  });
  return rawText;
}

function exitRpWithoutSave() {
  if (confirm("确定不存档就退出吗？下次需要重新开始。")) finishStopRoleplay();
}

function finishStopRoleplay() {
  closeRpSaveModal();
  rpActive = false;
  rpConfig = null;
  rpConvHistory = [];
  document.getElementById("rpBanner").style.display = "none";

  const ts = Date.now();
  appendRpSystemMsg("🎭 角色扮演已结束，已恢复原来的人设");
  chatMessages.push({ role: "system", text: "🎭 角色扮演已结束", isRoleplay: true, time: ts });

  saveChatHistory();
  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
}


// ============================================================
// === Dress-up System — 换装系统 ===
// ============================================================
let dressupPendingImage = null; // { dataUrl, base64, mediaType }
let currentOutfitUrl = null; // thumbnail dataUrl for panel display

function updateDressupIcon() {
  const icon = document.getElementById("dressupIcon");
  const status = document.getElementById("dressupStatus");
  if (currentOutfitUrl) {
    icon.innerHTML = `<img src="${currentOutfitUrl}" />`;
    status.textContent = "已换装";
  } else {
    icon.innerHTML = "👕";
    status.textContent = "默认穿搭";
  }
}

function createOutfitThumbnail(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 150;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function saveOutfitToMemory() {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    if (currentOutfitUrl) {
      const blob = await fetch(currentOutfitUrl).then(r => r.blob());
      const fh = await memoryDirHandle.getFileHandle("current-outfit.jpg", { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      try { await memoryDirHandle.removeEntry("current-outfit.jpg"); } catch(e) {}
    }
  } catch(e) { console.warn("Save outfit error:", e); }
}

async function restoreOutfitFromMemory() {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    const fh = await memoryDirHandle.getFileHandle("current-outfit.jpg");
    const f = await fh.getFile();
    currentOutfitUrl = URL.createObjectURL(f);
    updateDressupIcon();
  } catch(e) { /* file doesn't exist = default outfit */ }
}

function toggleDressupPanel() {
  const panel = document.getElementById("dressupPanel");
  const overlay = document.getElementById("dressupOverlay");
  panel.classList.toggle("open");
  overlay.classList.toggle("open");
  if (!panel.classList.contains("open")) {
    clearDressupPreview();
  }
}

function handleDressupImage(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSize = 1024;
