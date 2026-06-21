let stickerCatalog = []; // [{name, url, fileName}]
async function loadStickers() {
  stickerCatalog = [];
  if (!memoryDirHandle || !memoryEnabled) return;
  try {
    let stickersDir;
    try { stickersDir = await memoryDirHandle.getDirectoryHandle("stickers"); }
    catch(e) { return; }

    for await (const [name, handle] of stickersDir.entries()) {
      if (handle.kind !== "file") continue;
      const ext = name.split(".").pop().toLowerCase();
      if (!["jpg","jpeg","png","gif","webp","svg","bmp"].includes(ext)) continue;
      const stickerName = name.replace(/\.\w+$/, "");
      const f = await handle.getFile();

      // Compress/resize to max 300x300 for performance
      let url;
      if (ext === "gif" || ext === "svg") {
        // GIF/SVG keep original (GIF animation would break with canvas)
        url = URL.createObjectURL(f);
      } else {
        try {
          url = await resizeImage(f, 300);
        } catch(e) {
          url = URL.createObjectURL(f);
        }
      }
      stickerCatalog.push({ name: stickerName, url, fileName: name });
    }
    if (stickerCatalog.length > 0) {
      console.log("[Stickers] Loaded:", stickerCatalog.length, "stickers");
    }
  } catch(e) { console.warn("Sticker load error:", e); }
}

function resizeImage(file, maxSize) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w <= maxSize && h <= maxSize) {
        resolve(URL.createObjectURL(file));
        return;
      }
      const scale = Math.min(maxSize / w, maxSize / h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (blob) resolve(URL.createObjectURL(blob));
        else resolve(URL.createObjectURL(file));
      }, "image/png");
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// --- Sticker Picker UI ---
function toggleStickerPicker() {
  const picker = document.getElementById("stickerPicker");
  picker.classList.toggle("visible");
  if (picker.classList.contains("visible")) {
    populateStickerGrid();
  }
}

// Close sticker picker when clicking outside
document.addEventListener("click", (e) => {
  const picker = document.getElementById("stickerPicker");
  const btn = document.getElementById("stickerPickerBtn");
  if (picker && picker.classList.contains("visible") && !picker.contains(e.target) && e.target !== btn) {
    picker.classList.remove("visible");
  }
});

function populateStickerGrid() {
  const grid = document.getElementById("stickerGrid");
  const empty = document.getElementById("stickerEmpty");
  grid.innerHTML = "";

  if (stickerCatalog.length === 0) {
    empty.style.display = "block";
    grid.style.display = "none";
    return;
  }
  empty.style.display = "none";
  grid.style.display = "grid";

  for (const sticker of stickerCatalog) {
    const item = document.createElement("div");
    item.className = "sticker-grid-item";
    item.title = sticker.name;
    item.innerHTML = `<img src="${sticker.url}" alt="${escapeHtml(sticker.name)}" />`;
    item.onclick = () => sendUserSticker(sticker);
    grid.appendChild(item);
  }
}

async function sendUserSticker(sticker) {
  toggleStickerPicker(); // close picker
  if (isBusy) return;
  isBusy = true;

  // Display sticker in chat
  const area = document.getElementById("chatArea");
  const emptyState = document.getElementById("emptyState");
  if (emptyState) emptyState.remove();

  const ts = Date.now();
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `
    <div class="bubble user" style="background:transparent;border:none;padding:4px">
      <img class="user-sticker-img" src="${sticker.url}" alt="${escapeHtml(sticker.name)}" />
    </div>
    <div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  // Convert sticker to base64 for persistent storage
  let stickerDataUrl = null;
  try {
    const resp = await fetch(sticker.url);
    const blob = await resp.blob();
    stickerDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch(e) { console.warn("Sticker base64 conversion failed:", e); }

  chatMessages.push({ role: "user", text: `[表情包:${sticker.name}]`, isSticker: true, stickerName: sticker.name, stickerDataUrl, time: ts });
  saveChatHistory();

  // Send to Claude as text description
  const stickerMsg = `[【用户称呼代词】发了一个表情包：${sticker.name}]`;

  // Build system prompt BEFORE pushing to history
  const systemPrompt = await buildSystemWithRecall(stickerMsg);

  conversationHistory.push({ role: "user", content: stickerMsg });
  imprintLogTurn("user", stickerMsg);

  // Get Claude's response
  setLoading(true);
  document.getElementById("statusBar").textContent = "正在思考...";

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: safeStringify({
        model: chatModel, max_tokens: 500,
        ...(webSearchEnabled ? {tools:[{type:"web_search_20250305",name:"web_search"}]} : {}),
        system: systemPrompt,
        messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim()))
      })
    });

    if (!claudeRes.ok) {
      const et = await claudeRes.text().catch(()=>"");
      throw new Error("Claude API 错误 (" + claudeRes.status + "): " + (et || "").slice(0, 200));
    }
    const claudeData = await claudeRes.json();
    const rawText = claudeData.content.filter(c => c.type === "text" && c.text).map(c => c.text).pop() || "";
    const messages = parseClaudeResponse(rawText);
    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);

    setLoading(false);
    document.getElementById("statusBar").textContent = "正在生成语音...";
    await showMultipleMessages(messages);
    lastMessageTime = Date.now();
    scheduleProactiveMessage(3);
  } catch(e) {
    console.error("Sticker response error:", e);
    setLoading(false);
    appendBotMessage("hmm...", `${e.message}`, null, false);
  }

  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  isBusy = false;
}

