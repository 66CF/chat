// === Lazy Loading Helpers ===
async function renderOneMessage(msg) {
  if (msg.role === "system" && msg.isRoleplay) {
    // Roleplay system message (start, save load, end)
    const area = document.getElementById("chatArea");
    const row = document.createElement("div");
    row.className = "msg-row";
    row.style.justifyContent = "center";
    row.innerHTML = `<div class="rp-system-msg">${escapeHtml(msg.text)}</div>`;
    area.appendChild(row);
    return;
  }
  // Music notification
  if (msg.role === "system" && msg.isMusicNotif) {
    const area = document.getElementById("chatArea");
    const div = document.createElement("div");
    div.className = "music-notif";
    div.textContent = msg.text;
    area.appendChild(div);
    return;
  }
  if (msg.role === "peek") {
    if (msg.peekId) await appendScreenshotFromDB(msg.peekId);
    else if (msg.screenshot) appendScreenshotBubble(msg.screenshot);
  } else if (msg.role === "user") {
    if (msg.isVoice && msg.voiceAudioId) {
      const msgId = "vmsg_r_" + Math.random().toString(36).slice(2,8);
      appendVoiceMessage(msgId, null, msg.duration || "?", msg.text || "", msg.voiceAudioId, true, msg.time);
    } else if (msg.isSticker && msg.stickerName) {
      const st = findSticker(msg.stickerName);
      const _stickerSrc = st ? st.url : msg.stickerDataUrl;
      if (_stickerSrc) {
        const area = document.getElementById("chatArea");
        const row = document.createElement("div");
        row.className = "msg-row user";
        row.innerHTML = '<div class="bubble user" style="background:transparent;border:none;padding:4px"><img class="user-sticker-img" src="' + _stickerSrc + '" /></div><div class="msg-time">' + formatMsgTime(msg.time) + '</div>';
        area.appendChild(row);
      } else { appendMessage("user", msg.text || "[表情包]", false, msg.time, msg.quote); }
    } else if (msg.isImage && msg.imgId) {
      await appendImageFromDB(msg.imgId, msg.text);
    } else {
      if (msg.fileName && (!msg.text || msg.text.startsWith("[发了文件"))) {
        const quoteHtml = msg.quote ? buildQuoteBlockHtml(msg.quote) : "";
        const _area = document.getElementById("chatArea");
        const _row = document.createElement("div");
        _row.className = "msg-row user";
        _row.innerHTML = '<div class="bubble user">' + quoteHtml + '<div class="file-attach-tag">📄 ' + escapeHtml(msg.fileName) + '</div></div><div class="msg-time">' + formatMsgTime(msg.time) + '</div>';
        _area.appendChild(_row);
      } else {
        appendMessage("user", msg.text, false, msg.time, msg.quote);
        if (msg.fileName) {
          const _lr = document.getElementById("chatArea").lastElementChild;
          const _bb = _lr ? _lr.querySelector(".bubble") : null;
          if (_bb) _bb.insertAdjacentHTML("afterbegin", '<div class="file-attach-tag">📄 ' + escapeHtml(msg.fileName) + '</div>');
        }
      }
    }
  } else {
    if (msg.isRoleplay) {
      // Roleplay message — special formatting, no audio
      const area = document.getElementById("chatArea");
      const row = document.createElement("div");
      row.className = "msg-row bot";
      const avatarHtml = customAvatarUrl
        ? `<img src="${customAvatarUrl}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`
        : "♡";
      const bubbleClass = msg.isOoc ? "bubble bot rp-ooc-bubble" : "bubble bot rp-bubble";
      const content = msg.isOoc ? escapeHtml(msg.chinese || "") : formatRoleplayHtml(msg.chinese || "");
      row.innerHTML = `<div class="avatar">${avatarHtml}</div><div class="${bubbleClass}">${content}</div><div class="msg-time">${formatMsgTime(msg.time)}</div>`;
      area.appendChild(row);
    } else {
    appendBotMessage(msg.english, msg.chinese, null, false, msg.audioId || null, msg.time, msg.quote);
    if (msg.stickerName) {
      const _bst = findSticker(msg.stickerName);
      const _bsrc = _bst ? _bst.url : msg.stickerDataUrl;
      if (_bsrc) {
        const _lastRow = document.getElementById("chatArea").lastElementChild;
        const _bubble = _lastRow ? _lastRow.querySelector(".bubble.bot") : null;
        if (_bubble) _bubble.insertAdjacentHTML("beforeend", '<img class="sticker-img" src="' + _bsrc + '" />');
      }
    }
    if (msg.fileName && msg.fileContent) {
      let _fdlUrl, _fdlName;
      if (msg.fileName.toLowerCase().endsWith(".pdf")) {
        try { _fdlUrl = await createPdfFile(msg.fileName, msg.fileContent); _fdlName = msg.fileName; }
        catch(e) { const _fdl = createFileDownload(msg.fileName, msg.fileContent); _fdlUrl = _fdl.url; _fdlName = _fdl.filename; }
      } else {
        const _fdl = createFileDownload(msg.fileName, msg.fileContent); _fdlUrl = _fdl.url; _fdlName = _fdl.filename;
      }
      const _flr = document.getElementById("chatArea").lastElementChild;
      const _fbb = _flr ? _flr.querySelector(".bubble.bot") : null;
      if (_fbb) _fbb.insertAdjacentHTML("beforeend", '<a class="file-download-btn" href="' + _fdlUrl + '" download="' + escapeHtml(_fdlName) + '">📥 下载 ' + escapeHtml(_fdlName) + '</a>');
    }
    } // close non-roleplay else
  }
}

function insertLoadMoreBanner() {
  const area = document.getElementById("chatArea");
  const existing = document.getElementById("loadMoreBanner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.id = "loadMoreBanner";
  banner.className = "load-more-banner";
  banner.textContent = "↑ 加载更早的消息 ↑";
  banner.onclick = () => loadOlderMessages();
  area.insertBefore(banner, area.firstChild);
}

let _loadingOlder = false;
let _scrollListenerAdded = false;

// === Lazy Blob Loading ===
function collectBlobIds(messages) {
  const ids = [];
  for (const msg of messages) {
    if (msg.audioId) ids.push(msg.audioId);
    if (msg.voiceAudioId) ids.push(msg.voiceAudioId);
    if (msg.peekId) ids.push(msg.peekId);
    if (msg.imgId) ids.push(msg.imgId);
  }
  return ids;
}

async function loadBlobsForMessages(messages) {
  if (!memoryEnabled || !memoryDirHandle || messages.length === 0) return;
  let blobsDir;
  try { blobsDir = await memoryDirHandle.getDirectoryHandle("blobs"); }
  catch(e) { return; }
  const ids = collectBlobIds(messages);
  for (const id of ids) {
    const existing = await AudioDB.load(id);
    if (existing) continue;
    const ext = id.startsWith("peek_") ? ".jpg" : id.startsWith("img_") ? ".png" : ".webm";
    try {
      const fh = await blobsDir.getFileHandle(id + ext);
      const f = await fh.getFile();
      await AudioDB.save(id, f);
    } catch(e) {}
  }
}

async function loadOlderMessages() {
  if (_loadingOlder || chatRenderStart <= 0) return;
  _loadingOlder = true;
  const area = document.getElementById("chatArea");
  const banner = document.getElementById("loadMoreBanner");
  if (banner) banner.textContent = "加载中...";

  const newEnd = chatRenderStart;
  const newStart = Math.max(0, chatRenderStart - CHAT_PAGE_SIZE);
  const slice = chatMessages.slice(newStart, newEnd);

  // Lazy-load blobs for this batch before rendering
  await loadBlobsForMessages(slice);

  // Record scroll state before prepending
  const prevScrollHeight = area.scrollHeight;

  // Render older messages (appends to end), then move to top
  const childCountBefore = area.children.length;
  for (const msg of slice) {
    await renderOneMessage(msg);
  }
  // Move newly appended nodes to the top (before old first content node)
  const firstOldNode = banner ? banner.nextSibling : area.children[childCountBefore];
  const totalChildren = area.children.length;
  const newNodes = [];
  for (let i = childCountBefore; i < totalChildren; i++) {
    newNodes.push(area.children[i]);
  }
  for (const node of newNodes) {
    area.insertBefore(node, firstOldNode);
  }

  chatRenderStart = newStart;

  // Update or remove banner
  if (chatRenderStart > 0) {
    if (banner) banner.textContent = "↑ 加载更早的消息 ↑";
    // Make sure banner stays at top
    if (banner && area.firstChild !== banner) area.insertBefore(banner, area.firstChild);
  } else {
    if (banner) banner.remove();
  }

  // Restore scroll position so view doesn't jump
  const addedHeight = area.scrollHeight - prevScrollHeight;
  area.scrollTop += addedHeight;

  _loadingOlder = false;
}

function onChatScrollTop() {
  const area = document.getElementById("chatArea");
  if (area.scrollTop < 80 && chatRenderStart > 0 && !_loadingOlder) {
    loadOlderMessages();
  }
}

// === Chat ===

// Parse DeepSeek response: handles both array and single object
function parseDeepSeekResponse(rawText) {
  const clean = (rawText || "").replace(/```json|```/g, "").trim();
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
      throw new Error("回复解析失败");
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
  return msgs;
}

// Display multiple messages with sequential TTS
async function showMultipleMessages(messages) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Small delay between messages (looks like real typing)
    if (i > 0) await new Promise(r => setTimeout(r, 600 + Math.random() * 800));

    // Generate TTS for this message
    let audioUrl = null, savedAudioId = null;
    try {
      const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": elevenApiKey },
        body: safeStringify({
          text: msg.english, model_id: "eleven_v3",
          voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true } /* 【TTS语音参数：stability=稳定性(0-1)，similarity_boost=音色相似度(0-1)，style=风格强度(0-1)，请根据所选ElevenLabs音源微调这些数值】 */
        })
      });
      if (ttsRes.ok) {
        const ab = await ttsRes.blob();
        audioUrl = URL.createObjectURL(ab);
        savedAudioId = "audio_" + Date.now() + "_" + i;
        await AudioDB.save(savedAudioId, ab);
      }
    } catch(e) { console.error("TTS error:", e); }

    appendBotMessage(msg.english, msg.chinese, audioUrl, true, savedAudioId);

    // If message has a file attachment, add download button and persist
    if (msg.file && msg.file.name && msg.file.content) {
      const fname = msg.file.name;
      const isPdf = fname.toLowerCase().endsWith(".pdf");
      let dlUrl, dlName;

      if (isPdf) {
        try {
          dlUrl = await createPdfFile(fname, msg.file.content);
          dlName = fname;
        } catch(e) {
          console.warn("PDF generation failed, falling back to txt:", e);
          const dl = createFileDownload(fname.replace(/\.pdf$/i, ".txt"), msg.file.content);
          dlUrl = dl.url; dlName = dl.filename;
        }
      } else {
        const dl = createFileDownload(fname, msg.file.content);
        dlUrl = dl.url; dlName = dl.filename;
      }

      const area = document.getElementById("chatArea");
      const lastRow = area.lastElementChild;
      const bubble = lastRow.querySelector(".bubble.bot");
      if (bubble) {
        bubble.insertAdjacentHTML("beforeend",
          `<a class="file-download-btn" href="${dlUrl}" download="${escapeHtml(dlName)}">📥 下载 ${escapeHtml(dlName)}</a>`
        );
      }
      const lastMsg = chatMessages[chatMessages.length - 1];
      if (lastMsg && lastMsg.role === "bot") {
        lastMsg.fileName = msg.file.name;
        lastMsg.fileContent = msg.file.content;
        saveChatHistory();
      }
    }

    // If message has a sticker, display it and persist
    if (msg.sticker) {
      const sticker = findSticker(msg.sticker);
      if (sticker) {
        const area = document.getElementById("chatArea");
        const lastRow = area.lastElementChild;
        const bubble = lastRow.querySelector(".bubble.bot");
        if (bubble) {
          bubble.insertAdjacentHTML("beforeend",
            `<img class="sticker-img" src="${sticker.url}" alt="${escapeHtml(sticker.name)}" title="${escapeHtml(sticker.name)}" onclick="window.open(this.src,'_blank')" />`
          );
        }
        // Save sticker info in chatMessages for persistence
        const lastMsg = chatMessages[chatMessages.length - 1];
        if (lastMsg && lastMsg.role === "bot") {
          lastMsg.stickerName = sticker.name;
          // Convert to base64 for persistent storage
          try {
            const resp = await fetch(sticker.url);
            const blob = await resp.blob();
            lastMsg.stickerDataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
          } catch(e) { console.warn("Bot sticker base64 error:", e); }
          saveChatHistory();
        }
      }
    }

    // Play audio and wait for it to finish before next message
    // Handle bot music action (切歌)
    if (msg.music) handleBotMusicAction(msg);

    if (audioUrl) {
      await new Promise(resolve => {
        const audio = new Audio(audioUrl);
        currentAudio = audio;
        audio.onended = () => { currentAudio = null; resolve(); };
        audio.onerror = () => { currentAudio = null; resolve(); };
        audio.play().catch(resolve);
      });
    }
  }
}

// === Image Messages ===
let pendingImage = null; // { dataUrl, base64, mediaType }

// === Attach Menu (image + file picker) ===
function toggleAttachMenu() {
  document.getElementById("attachMenu").classList.toggle("visible");
}
function pickImage() {
  document.getElementById("attachMenu").classList.remove("visible");
  document.getElementById("imgFileInput").click();
}
function pickFile() {
  document.getElementById("attachMenu").classList.remove("visible");
  document.getElementById("fileInput").click();
}
// Close attach menu when clicking outside
document.addEventListener("click", (e) => {
  const menu = document.getElementById("attachMenu");
  const btn = document.getElementById("attachBtn");
  if (menu && !menu.contains(e.target) && e.target !== btn) {
    menu.classList.remove("visible");
  }
});

function handlePaste(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      event.preventDefault();
      const file = item.getAsFile();
      processImageFile(file);
      return;
    }
  }
}

function handleImageFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) processImageFile(file);
}

function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const base64 = dataUrl.split(",")[1];
    const mediaType = file.type || "image/png";
    pendingImage = { dataUrl, base64, mediaType };
    showImagePreview(dataUrl);
  };
  reader.readAsDataURL(file);
}

function showImagePreview(dataUrl) {
  document.getElementById("imgPreviewThumb").src = dataUrl;
  document.getElementById("imgPreviewBar").style.display = "flex";
  document.getElementById("chatInput").placeholder = "输入文字一起发送，或直接点发送...";
  document.getElementById("chatInput").focus();
}

function clearImagePreview() {
  pendingImage = null;
  document.getElementById("imgPreviewBar").style.display = "none";
  document.getElementById("imgPreviewThumb").src = "";
  document.getElementById("chatInput").placeholder = "跟我说话...";
}

// === File Upload & Download ===
let pendingFile = null; // { name, content, type, isPdf, isDoc, base64 }

const TEXT_EXTENSIONS = new Set([
  // 文本
  "txt","md","markdown","rst","rtf","log","nfo","readme",
  // 编程语言
  "js","jsx","ts","tsx","py","pyw","rb","php","java","kt","kts","scala","groovy",
  "c","cpp","cc","cxx","h","hpp","hxx","cs","fs","fsx",
  "go","rs","swift","m","mm","dart","lua","pl","pm","r","rmd",
  "zig","nim","v","d","ada","adb","ads","f90","f95","f03","f08",
  "hs","lhs","ml","mli","ocaml","ex","exs","erl","hrl","clj","cljs","lisp","el","scm","rkt",
  "vb","vbs","bas","asm","s","wasm","wat",
  // Web
  "html","htm","xhtml","css","scss","sass","less","styl",
  "vue","svelte","astro","jsx","tsx","ejs","hbs","pug","jade",
  // 数据/配置
  "json","jsonl","json5","yaml","yml","toml","ini","cfg","conf","env","properties",
  "xml","xsl","xsd","dtd","svg","plist","graphql","gql","proto","protobuf",
  // Shell/脚本
  "sh","bash","zsh","fish","ps1","psm1","bat","cmd","vbs",
  // 数据库
  "sql","sqlite","prisma","graphql",
  // 标记/文档
  "tex","latex","bib","csv","tsv","org","wiki","adoc","asciidoc",
  // DevOps/Config
  "dockerfile","vagrantfile","makefile","cmake","gradle","sbt","gemfile","podfile",
  "gitignore","gitattributes","editorconfig","eslintrc","prettierrc","babelrc",
  "npmignore","dockerignore","htaccess","nginx",
  // 其他
  "diff","patch","lock","sum","mod","csproj","sln","xcodeproj","pbxproj",
  "ipynb","rmd","qmd","typ","mdx"
]);

// 二进制文档类型 → 只有 PDF 用 document block，其他提取文字
const DOC_EXTENSIONS = {
  "pdf": "application/pdf",
  "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "doc": "application/msword",
  "xls": "application/vnd.ms-excel",
  "ppt": "application/vnd.ms-powerpoint",
  "odt": "application/vnd.oasis.opendocument.text",
  "ods": "application/vnd.oasis.opendocument.spreadsheet",
  "odp": "application/vnd.oasis.opendocument.presentation",
  "epub": "application/epub+zip",
  "pages": "application/x-iwork-pages-sffpages",
  "numbers": "application/x-iwork-numbers-sffnumbers",
  "key": "application/x-iwork-keynote-sffkey"
};

// Dynamically load mammoth.js for docx text extraction
let mammothLoaded = false;
function loadMammoth() {
  if (mammothLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
    script.onload = () => { mammothLoaded = true; resolve(); };
    script.onerror = () => reject(new Error("无法加载 docx 解析库"));
    document.head.appendChild(script);
  });
}

// Extract text from docx using mammoth.js
// Sanitize text: remove unpaired Unicode surrogates and control chars that break JSON
function sanitizeText(text) {
  if (!text) return text;
  // Remove unpaired surrogates
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
             .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
             .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

async function extractDocxText(file) {
  await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return sanitizeText(result.value);
}

// Extract text from xlsx/pptx by reading XML from zip
async function extractOfficeXmlText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  // Use JSZip-like approach with native APIs — try to decompress and parse XML
  // Fallback: read raw bytes and extract readable text
  try {
    const bytes = new Uint8Array(arrayBuffer);
    // Find XML content between tags — office formats are ZIP archives with XML
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const raw = decoder.decode(bytes);
    // Extract text between XML tags
    const textParts = [];
    const tagRegex = />([^<]{2,})</g;
    let m;
    while ((m = tagRegex.exec(raw)) !== null) {
      const t = m[1].trim();
      if (t && !/^[\x00-\x1f\s]+$/.test(t) && !/^[A-Za-z0-9+/=\s]{50,}$/.test(t)) {
        textParts.push(t);
      }
    }
    if (textParts.length > 10) return sanitizeText(textParts.join("\n"));
  } catch(e) {}
  throw new Error("无法提取文件文字内容");
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";

  const ext = file.name.split(".").pop().toLowerCase();
  const maxSize = 10 * 1024 * 1024; // 10MB limit

  if (file.size > maxSize) {
    alert("文件太大了（最大10MB）");
    return;
  }

  try {
    if (DOC_EXTENSIONS[ext]) {
      if (ext === "pdf") {
        // PDF → send as base64 document block to DeepSeek API
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        pendingFile = { name: file.name, type: ext, isDoc: true, isPdf: true, base64, mediaType: "application/pdf", content: null };
      } else if (ext === "docx") {
        // DOCX → extract text using mammoth.js then send as text
        try {
          const content = await extractDocxText(file);
          if (!content || content.trim().length === 0) throw new Error("文件内容为空");
          if (content.length > 80000) {
            alert("文件内容太长了（最大8万字符），建议截取关键部分");
            return;
          }
          pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content };
        } catch(e) {
          alert("读取 .docx 文件失败: " + e.message);
          return;
        }
      } else {
        // Other office formats → try extracting text from XML in zip
        try {
          const content = await extractOfficeXmlText(file);
          if (content.length > 80000) {
            alert("文件内容太长了（最大8万字符），建议截取关键部分");
            return;
          }
          pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content };
        } catch(e) {
          alert("暂时只支持 PDF 和 DOCX 文件的直接读取。\n请将文件转为 PDF 或复制文字内容发送。");
          return;
        }
      }
    } else if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/") || ext === "") {
      // Text file → read as text
      const content = await file.text();
      if (content.length > 80000) {
        alert("文件内容太长了（最大8万字符），建议截取关键部分");
        return;
      }
      pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content };
    } else if (file.type.startsWith("image/")) {
      // Image → redirect to image handler
      processImageFile(file);
      return;
    } else {
      // Unknown → try reading as text
      try {
        const content = await file.text();
        if (content.includes("\\x00") || content.length === 0) throw new Error("binary");
        pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content: content.slice(0, 40000) };
      } catch(e) {
        // Binary file that can't be read as text — inform user
        alert("无法读取此文件。请转为 PDF、DOCX 或文本格式后重试。");
        return;
      }
    }

    document.getElementById("filePreviewBar").style.display = "flex";
    document.getElementById("filePreviewName").textContent = file.name + " (" + (file.size > 1024 ? Math.round(file.size/1024) + "KB" : file.size + "B") + ")";
    document.getElementById("chatInput").placeholder = "可以说说你想让【角色称呼代词】看什么...";
  } catch(e) {
    alert("读取文件失败: " + e.message);
  }
}

function clearFilePreview() {
  pendingFile = null;
  document.getElementById("filePreviewBar").style.display = "none";
  document.getElementById("chatInput").placeholder = "跟我说话...";
}

function createFileDownload(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return { url, filename };
}

// Dynamic script loader (reusable)
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function createPdfFile(filename, textContent) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

  const title = filename.replace(/\.pdf$/i, "");
  let html = `<div style="font-family:'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif;font-size:13pt;line-height:2;color:#222;padding:0;">`;
  html += `<h1 style="font-size:20pt;text-align:center;margin:0 0 20px;font-weight:700">${escapeHtml(title)}</h1>`;
  const lines = textContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { html += `<br/>`; continue; }
    if (trimmed.startsWith("#")) {
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.replace(/^#+\s*/, "");
      const sizes = {1:"18pt",2:"16pt",3:"14pt"};
      html += `<p style="font-size:${sizes[level]||"13pt"};font-weight:700;margin:16px 0 8px">${escapeHtml(text)}</p>`;
    } else {
      html += `<p style="margin:4px 0;text-indent:2em">${escapeHtml(trimmed)}</p>`;
    }
  }
  html += `</div>`;

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:520px;background:#fff;padding:0;";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageW = pdf.internal.pageSize.getWidth() - 20; // 10mm margins
    const pageH = pdf.internal.pageSize.getHeight() - 20;
    const imgW = canvas.width;
    const imgH = canvas.height;
    const ratio = pageW / (imgW / 2);
    const scaledH = (imgH / 2) * ratio;

    let y = 0;
    let page = 0;
    while (y < scaledH) {
      if (page > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 10, 10 - y, pageW, scaledH);
      y += pageH;
      page++;
    }

    const blob = pdf.output("blob");
    return URL.createObjectURL(blob);
  } finally {
    document.body.removeChild(container);
  }
}

async function appendImageMessage(text, dataUrl, save, time) {
  const ts = time || Date.now();
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row user";
  const textHtml = text ? `<div style="margin-top:6px">${escapeHtml(text)}</div>` : "";
  row.innerHTML = `
    <div class="bubble user">
      <img class="user-img-msg" src="${dataUrl}" onclick="window.open(this.src,'_blank')" />
      ${textHtml}
    </div>
    <div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  if (save) {
    const imgId = "img_" + Date.now();
    const blob = await fetch(dataUrl).then(r => r.blob());
    await AudioDB.save(imgId, blob);
    chatMessages.push({ role: "user", text: text || "[图片]", isImage: true, imgId, time: ts });
    saveChatHistory(); // triggers memory library sync
  }
}

async function appendImageFromDB(imgId, text) {
  const blob = await AudioDB.load(imgId);
  if (blob) {
    const url = URL.createObjectURL(blob);
    await appendImageMessage(text, url, false);
  } else {
    appendMessage("user", text || "[图片已过期]", false);
  }
}


// Content filter fallback - random cute lyrics
function getRandomLyricFallback() {
  const lyrics = [
    /* 【在此填入角色的哼歌/唱歌台词列表，格式如下：
    { english: "[singing] 英文歌词~", chinese: "🎵 中文歌词~ 🎶" },
    建议准备20-50条，涵盖开心、甜蜜、搞笑、温柔等不同情绪
    歌词内容应符合角色性格和与用户的关系设定 */
    { english: "[singing] La la la~ you make me smile~ every single day~", chinese: "🎵 啦啦啦~ 你让我微笑~ 每一天~ 🎶" },
    { english: "[singing softly] Hm hm hm~ thinking of you~ wondering what you do~", chinese: "🎵 嗯嗯嗯~ 想着你~ 你在做什么呢~ 🎶" },
    { english: "[singing] Do re mi~ fa so la~ ti do~ life is better with you~", chinese: "🎵 哆来咪~ 发嗦拉~ 西哆~ 有你生活更美好~ 🎶" },
  ];
  return [lyrics[Math.floor(Math.random() * lyrics.length)]];
}


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
    document.getElementById("statusBar").textContent = "正在思考...";

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

      const rawText = await callDeepSeekAPI({
        system: systemPrompt,
        messages: [...conversationHistory.slice(-20, -1).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())), { role: "user", content: apiContent }],
        max_tokens: 650
      });
      const messages = parseDeepSeekResponse(rawText);
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
        { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.base64 } },
        { type: "text", text: replyContext + (text || "[【用户称呼代词】发了一张图片给你，看看是什么并自然地反应]") }
      ];

      // Build system prompt BEFORE pushing to history
      const systemPrompt = await buildSystemWithRecall(text || "图片");

      conversationHistory.push({ role: "user", content: text || "[图片]" });
      imprintLogTurn("user", text || "[发了一张图片]");

      // Send with image
      const rawText2 = await callDeepSeekAPI({
        system: systemPrompt,
        messages: [...conversationHistory.slice(-20, -1).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())), { role: "user", content }],
        max_tokens: 650
      });
      const messages = parseDeepSeekResponse(rawText2);
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

      const rawText = await callDeepSeekAPI({
        system: systemPrompt,
        messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
        max_tokens: (currentGame && currentGame.type === "story_relay") ? 1200 : 650
      });
      const messages = parseDeepSeekResponse(rawText);
      conversationHistory.push({ role: "assistant", content: rawText });
      imprintLogTurn("assistant", rawText);

      document.getElementById("statusBar").textContent = "正在生成语音...";
      setLoading(false);
      await showMultipleMessages(messages);
      lastMessageTime = Date.now();
      scheduleProactiveMessage(3);

      document.getElementById("statusBar").textContent = "在线 · 语音已连接";
    }

  } catch (err) {
    console.error(err);
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

  const btnId = "btn-" + Date.now() + Math.random().toString(36).slice(2, 6);
  const dataAttr = audioId ? ` data-audio-id="${audioId}"` : "";

  let audioBtn;
  if (audioUrl) {
    audioBtn = `<button class="replay-btn" id="${btnId}"${dataAttr} onclick="replayAudio(this, '${audioUrl}')">🔈 再听一次</button>`;
  } else if (audioId) {
    audioBtn = `<button class="replay-btn" id="${btnId}"${dataAttr} onclick="replayFromDB(this, '${audioId}')">🔈 再听一次</button>`;
  } else {
    audioBtn = `<span style="font-size:11px;color:#555;margin-top:6px;display:block">（语音不可用）</span>`;
  }

  const quoteHtml = quoteData ? buildQuoteBlockHtml(quoteData) : "";

  row.innerHTML = `<div class="bubble bot">${quoteHtml}<div class="english">${escapeHtml(english)}</div><div class="chinese">${escapeHtml(chinese)}</div>${audioBtn}</div><div class="msg-time">${formatMsgTime(ts)}</div>`;
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

// === Multi-message Batch Mode ===
let batchMode = false;
let stagedMessages = []; // { text, quoteData, imageData, fileData }

function showToast(msg, duration) {
  let el = document.getElementById("globalToast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.id = "globalToast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), duration || 1200);
}

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
  if (hasImage) clearImagePreview();
  if (hasFile) clearFilePreview();
  clearReply();
  renderStagedBar();
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
    document.getElementById("statusBar").textContent = "正在思考...";
    
    // Combine all texts for API
    const combinedText = combinedTexts.join("\n");
    const systemPrompt = await buildSystemWithRecall(combinedText);
    
    conversationHistory.push({ role: "user", content: combinedText });
    imprintLogTurn("user", combinedText);
    
    const rawText = await callDeepSeekAPI({
      system: systemPrompt,
      messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim())),
      max_tokens: 650
    });
    const messages = parseDeepSeekResponse(rawText);
    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);
    
    document.getElementById("statusBar").textContent = "正在生成语音...";
    setLoading(false);
    await showMultipleMessages(messages);
    lastMessageTime = Date.now();
    scheduleProactiveMessage(3);
    document.getElementById("statusBar").textContent = "在线 · 语音已连接";
    
  } catch (err) {
    console.error(err);
    setLoading(false);
    showError(err.message);
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
