// === Bubble Replay (click bubble to replay audio) ===
function handleBubbleReplay(bubble) {
  const audioUrl = bubble.dataset.audioUrl;
  const audioId = bubble.dataset.audioId;

  // Stop any currently playing audio
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }

  // Remove playing state from all other bubbles
  document.querySelectorAll(".bubble-audio.audio-playing").forEach(b => {
    if (b !== bubble) b.classList.remove("audio-playing");
  });

  function play(url) {
    const audio = new Audio(url);
    currentAudio = audio;
    bubble.classList.add("audio-playing");
    audio.onended = () => { bubble.classList.remove("audio-playing"); currentAudio = null; };
    audio.onerror = () => { bubble.classList.remove("audio-playing"); currentAudio = null; };
    audio.play().catch(() => { bubble.classList.remove("audio-playing"); });
  }

  if (audioUrl) {
    play(audioUrl);
  } else if (audioId) {
    AudioDB.load(audioId).then(blob => {
      if (!blob) return;
      play(URL.createObjectURL(blob));
    });
  }
}

// === Replay Audio ===
function replayAudio(btn, audioUrl) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  btn.disabled = true;
  btn.textContent = "🔊 播放中...";
  const audio = new Audio(audioUrl);
  currentAudio = audio;
  audio.onended = () => { btn.disabled = false; btn.textContent = "🔈 再听一次"; currentAudio = null; };
  audio.onerror = () => { btn.disabled = false; btn.textContent = "🔈 再听一次"; currentAudio = null; };
  audio.play().catch(() => { btn.disabled = false; btn.textContent = "🔈 再听一次"; });
}

async function replayFromDB(btn, audioId) {
  const blob = await AudioDB.load(audioId);
  if (!blob) { btn.textContent = "✕ 音频不可用"; return; }
  const url = URL.createObjectURL(blob);
  replayAudio(btn, url);
}

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
