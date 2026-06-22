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
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        const scale = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.split(",")[1];
      dressupPendingImage = { dataUrl, base64, mediaType: "image/jpeg" };

      // Show preview
      document.getElementById("dressupPreviewImg").src = dataUrl;
      document.getElementById("dressupPreview").classList.add("visible");
      document.getElementById("dressupText").value = "";
      document.getElementById("dressupText").focus();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function clearDressupPreview() {
  dressupPendingImage = null;
  document.getElementById("dressupPreview").classList.remove("visible");
  document.getElementById("dressupText").value = "";
}

async function sendDressupOutfit() {
  if (!dressupPendingImage || isBusy) return;
  const imageData = { ...dressupPendingImage };
  const extraText = document.getElementById("dressupText").value.trim();

  clearDressupPreview();
  toggleDressupPanel();

  isBusy = true;

  const ts = Date.now();
  const area = document.getElementById("chatArea");
  const emptyState = document.getElementById("emptyState");
  if (emptyState) emptyState.remove();

  // Show in chat: image + context
  const row = document.createElement("div");
  row.className = "msg-row user";
  const textHtml = extraText ? `<div style="margin-top:6px">${escapeHtml(extraText)}</div>` : "";
  row.innerHTML = `
    <div class="bubble user">
      <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:6px">👔 递给【角色称呼代词】一件衣服</div>
      <img class="user-img-msg" src="${imageData.dataUrl}" onclick="window.open(this.src,'_blank')" />
      ${textHtml}
    </div>
    <div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  // Save image to IndexedDB
  const imgId = "img_" + ts;
  try {
    const blob = await fetch(imageData.dataUrl).then(r => r.blob());
    await AudioDB.save(imgId, blob);
  } catch(e) {}
  chatMessages.push({ role: "user", text: `[换装:递给【角色称呼代词】一件衣服]${extraText ? " " + extraText : ""}`, isImage: true, imgId, time: ts });
  saveChatHistory();

  // Send to MiMo — normal image message with dressing context
  const dressupMsg = extraText
    ? `[【用户称呼代词】打开了更衣间，递给你一张衣服的图片想让你换上，同时说: "${extraText}"] 看看图片里的衣服，根据你的性格和喜好自然地反应——【角色可能的反应方式列表，如：你可以欣然接受穿上、嫌弃但勉强穿、不想穿、吐槽衣服风格、或者任何符合你性格的反应】。记住你是有自己审美和主见的【角色身份】。IMPORTANT: Reply with 2-4 separate JSON messages!`
    : `[【用户称呼代词】打开了更衣间，递给你一张衣服的图片想让你换上] 看看图片里的衣服，根据你的性格和喜好自然地反应——【角色可能的反应方式列表】。记住你是有自己审美和主见的【角色身份】。IMPORTANT: Reply with 2-4 separate JSON messages!`;

  const content = [
    { type: "image_url", image_url: { url: "data:" + imageData.mediaType + ";base64," + imageData.base64 } },
    { type: "text", text: dressupMsg }
  ];

  setLoading(true);
  document.getElementById("statusBar").textContent = "正在看衣服...";

  try {
    const systemPrompt = await buildSystemWithRecall(extraText || "换装 衣服");
    conversationHistory.push({ role: "user", content: `[换装:递了一件衣服]${extraText ? " " + extraText : ""}` });
    imprintLogTurn("user", `[换装:递了一件衣服的图片]${extraText ? " " + extraText : ""}`);

    const rawText = await callMiMoAPI({
      system: systemPrompt,
      messages: [...conversationHistory.slice(-20, -1).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())), { role: "user", content }],
      max_tokens: 650
    });
    const messages = parseMiMoResponse(rawText);
    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);

    setLoading(false);
    document.getElementById("statusBar").textContent = "正在生成语音...";
    await showMultipleMessages(messages);
    lastMessageTime = Date.now();
    scheduleProactiveMessage(3);

    // Update current outfit thumbnail
    const thumb = await createOutfitThumbnail(imageData.dataUrl);
    if (thumb) {
      currentOutfitUrl = thumb;
      updateDressupIcon();
      saveOutfitToMemory();
    }
  } catch(e) {
    console.error("Dressup error:", e);
    setLoading(false);
    appendBotMessage("[confused] huh?", `啊？${e.message}`, null, false);
  }

  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  isBusy = false;
}

async function sendDefaultOutfit() {
  if (isBusy) return;
  toggleDressupPanel();
  isBusy = true;

  const ts = Date.now();
  const area = document.getElementById("chatArea");
  const emptyState = document.getElementById("emptyState");
  if (emptyState) emptyState.remove();

  // Show in chat
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `
    <div class="bubble user" style="text-align:center;font-size:14px">
      <span style="font-size:28px">🔄👕</span><br>
      <span style="color:var(--user-bubble-text)">让【角色称呼代词】换回默认穿搭</span>
    </div>
    <div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  chatMessages.push({ role: "user", text: "[换装:让【角色称呼代词】换回默认穿搭]", time: ts });
  saveChatHistory();

  const defaultMsg = `[【用户称呼代词】打开更衣间，让你换回你的日常穿搭] 自然地反应，【角色换回默认穿搭时可能的反应描述，如：可以开心地换回来、或者假装不舍得刚才那件衣服】。IMPORTANT: Reply with 1-3 separate JSON messages!`;

  const systemPrompt = await buildSystemWithRecall("换回默认衣服");
  conversationHistory.push({ role: "user", content: "[换装:换回默认穿搭]" });
  imprintLogTurn("user", "[让【角色称呼代词】换回默认穿搭]");

  setLoading(true);
  document.getElementById("statusBar").textContent = "正在换衣服...";

  try {
    const rawText = await callMiMoAPI({
      system: systemPrompt,
      messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
      max_tokens: 500
    });
    const messages = parseMiMoResponse(rawText);
    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);

    setLoading(false);
    await showMultipleMessages(messages);
    lastMessageTime = Date.now();
    scheduleProactiveMessage(3);

    document.getElementById("dressupStatus").textContent = "默认穿搭";
    currentOutfitUrl = null;
    updateDressupIcon();
    saveOutfitToMemory();
  } catch(e) {
    console.error("Default outfit error:", e);
    setLoading(false);
    appendBotMessage("【角色换回默认穿搭时的英文短回复】", "【角色换回默认穿搭时的中文短回复】", null, false);
  }

  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  isBusy = false;
}


// ============================================================
