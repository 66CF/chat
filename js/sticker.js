let stickerCatalog = []; // [{name, url, fileName}]

async function loadStickers() {
  stickerCatalog = [];
  try {
    const resp = await fetch("/sticks.json");
    if (!resp.ok) return;
    const names = await resp.json();
    
    for (const name of names) {
      const url = `/sticks/${name}.gif`;
      stickerCatalog.push({ name, url, fileName: `${name}.gif` });
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

function buildStickerContext() {
  if (stickerCatalog.length === 0) return "";
  const names = stickerCatalog.map(s => s.name).join("、");
  return `\n\n<stickers>
可用表情包：${names}
名字=画面内容，根据情境选最合适的。发送方式：在消息加"sticker"字段，值必须完全匹配列表名称。
例：{"english":"hehe~","chinese":"嘿嘿~","sticker":"得意"}
省着用！平均每10-15条消息发一次。
</stickers>`;
}

function findSticker(name) {
  if (!name || stickerCatalog.length === 0) return null;
  const lower = name.toLowerCase().trim();
  // 1. Exact match
  let match = stickerCatalog.find(s => s.name.toLowerCase() === lower);
  if (match) return match;
  // 2. Name contains query or query contains name
  match = stickerCatalog.find(s => s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase()));
  if (match) return match;
  // 3. Fuzzy: any sticker name shares 2+ characters with query
  match = stickerCatalog.find(s => {
    const sn = s.name.toLowerCase();
    let shared = 0;
    for (const ch of lower) { if (sn.includes(ch)) shared++; }
    return shared >= Math.min(2, lower.length);
  });
  return match || null;
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

  // Send to MiMo as text description
  const stickerMsg = `[用户发了一个表情包：${sticker.name}]`;

  // Build system prompt BEFORE pushing to history
  const systemPrompt = await prepareBotContext(stickerMsg, stickerMsg);

  // Get MiMo's response
  setLoading(true);
  document.getElementById("statusBar").textContent = "正在思考...";

  try {
    const rawText = await callMiMoAPI({
      system: systemPrompt,
      messages: getRecentMessages(),
      max_tokens: 8192
    });

    await handleBotReply(rawText);

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

