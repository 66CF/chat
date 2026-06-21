// ============================================================
// === Music — 一起听系统 ===
// ============================================================
let musicPlaylist = []; // [{name, fileName, handle, url, duration}]
let musicCurrentIdx = -1;
let musicAudio = null; // HTMLAudioElement
let musicPlaying = false;
let musicMode = "list"; // list | single | shuffle
let musicListenTogether = false; // bot-aware mode
let musicProgressTimer = null;

// Session tracking & history
let musicSession = { active: false, startTime: null, tracksPlayed: [] };
let musicHistory = []; // [{date, startTime, endTime, tracks:[]}]
let musicVolume = 0.8; // music-only volume (0-1)

function toggleMusicPanel() {
  document.getElementById("musicPanel").classList.toggle("open");
  document.getElementById("musicOverlay").classList.toggle("open");
  if (document.getElementById("musicPanel").classList.contains("open")) {
    renderMusicLibrary();
  }
}

function toggleFeaturesSidebar() {
  document.getElementById("featuresSidebar").classList.toggle("open");
  document.getElementById("featuresOverlay").classList.toggle("open");
}

// === Music Library ===
async function loadMusicLibrary() {
  musicPlaylist = [];
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    let musicDir;
    try { musicDir = await memoryDirHandle.getDirectoryHandle("music"); }
    catch(e) { return; } // folder doesn't exist yet
    for await (const [name, handle] of musicDir.entries()) {
      if (handle.kind !== "file") continue;
      const ext = name.split(".").pop().toLowerCase();
      if (!["mp3","m4a","ogg","wav","flac","aac","wma","opus","webm"].includes(ext)) continue;
      const trackName = name.replace(/\.\w+$/, "");
      musicPlaylist.push({ name: trackName, fileName: name, handle, url: null, duration: null });
    }
    musicPlaylist.sort((a,b) => a.name.localeCompare(b.name, "zh"));
    if (musicPlaylist.length > 0) console.log("[Music] Loaded:", musicPlaylist.length, "tracks");
  } catch(e) { console.warn("Music load error:", e); }
}

function renderMusicLibrary() {
  const body = document.getElementById("musicPanelBody");
  if (musicPlaylist.length === 0) {
    body.innerHTML = `<div class="music-empty">
      🎵 还没有歌曲<br><br>
      在记忆库文件夹里建一个 <b>music</b> 文件夹<br>
      把 mp3/m4a/ogg 等音频文件放进去<br><br>
      <span style="color:var(--accent)">放好后重新打开面板即可加载</span>
      <br><br><button onclick="loadMusicLibrary().then(()=>renderMusicLibrary())" style="padding:8px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent-glow);color:var(--accent);cursor:pointer;font-size:12px">🔄 重新扫描</button>
    </div>`;
    return;
  }
  // Listen together toggle
  const ltClass = musicListenTogether ? "selected" : "";
  let html = `<div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
    <span class="pd-opt ${ltClass}" onclick="toggleListenTogether(this)" style="font-size:11px">💑 一起听模式</span>
    <span style="font-size:10px;color:var(--text-dim);flex:1">${musicListenTogether ? "【角色名称】 可以帮你切歌" : "开启后 【角色名称】 能看到歌单"}</span>
    <button onclick="loadMusicLibrary().then(()=>renderMusicLibrary())" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;color:var(--text-dim);font-size:10px;cursor:pointer">🔄</button>
  </div>`;
  html += musicPlaylist.map((t, i) => {
    const active = i === musicCurrentIdx ? " active" : "";
    const icon = i === musicCurrentIdx && musicPlaying ? "▶" : (i + 1);
    return `<div class="music-track${active}" onclick="playTrack(${i})">
      <span class="mt-num">${icon}</span>
      <span class="mt-name" title="${escapeHtml(t.fileName)}">${escapeHtml(t.name)}</span>
      <span class="mt-dur">${t.duration ? formatSec(t.duration) : ""}</span>
    </div>`;
  }).join("");
  body.innerHTML = html;
}

function toggleListenTogether(el) {
  musicListenTogether = !musicListenTogether;
  el.classList.toggle("selected", musicListenTogether);
  try { localStorage.setItem("vbc_music_listen_together", musicListenTogether ? "true" : "false"); } catch(e) {}
  renderMusicLibrary();
  if (musicListenTogether && musicPlaying) {
    showToast("💑 一起听模式已开启，【角色名称】 现在能看到你的歌单了");
  }
}

// === Playback ===
async function playTrack(idx) {
  if (idx < 0 || idx >= musicPlaylist.length) return;
  const track = musicPlaylist[idx];
  // Load URL if not yet loaded
  if (!track.url) {
    try {
      const f = await track.handle.getFile();
      track.url = URL.createObjectURL(f);
    } catch(e) { showToast("无法读取音频文件"); return; }
  }
  musicCurrentIdx = idx;
  if (!musicAudio) {
    musicAudio = new Audio();
    musicAudio.addEventListener("ended", onMusicEnded);
    musicAudio.addEventListener("loadedmetadata", () => {
      if (musicPlaylist[musicCurrentIdx]) {
        musicPlaylist[musicCurrentIdx].duration = musicAudio.duration;
      }
    });
  }
  musicAudio.src = track.url;
  musicAudio.volume = musicVolume;
  musicAudio.play();
  musicPlaying = true;
  updateMiniPlayer();
  startProgressTimer();
  // Log to session
  if (!musicSession.active) { musicSession.active = true; musicSession.startTime = Date.now(); musicSession.tracksPlayed = []; }
  if (!musicSession.tracksPlayed.includes(track.name)) musicSession.tracksPlayed.push(track.name);
  // Re-render library if panel open
  if (document.getElementById("musicPanel").classList.contains("open")) renderMusicLibrary();
}

function musicTogglePlay() {
  if (!musicAudio || musicCurrentIdx < 0) {
    if (musicPlaylist.length > 0) playTrack(0);
    return;
  }
  if (musicPlaying) { musicAudio.pause(); musicPlaying = false; }
  else { musicAudio.play(); musicPlaying = true; }
  updateMiniPlayer();
}

function musicNext() {
  if (musicPlaylist.length === 0) return;
  let next;
  if (musicMode === "shuffle") next = Math.floor(Math.random() * musicPlaylist.length);
  else if (musicMode === "single") next = musicCurrentIdx;
  else next = (musicCurrentIdx + 1) % musicPlaylist.length;
  playTrack(next);
}

function musicPrev() {
  if (musicPlaylist.length === 0) return;
  if (musicAudio && musicAudio.currentTime > 3) { musicAudio.currentTime = 0; return; }
  let prev = musicMode === "shuffle" ? Math.floor(Math.random() * musicPlaylist.length) : (musicCurrentIdx - 1 + musicPlaylist.length) % musicPlaylist.length;
  playTrack(prev);
}

function onMusicEnded() {
  musicPlaying = false;
  if (musicMode === "single") { musicAudio.currentTime = 0; musicAudio.play(); musicPlaying = true; }
  else musicNext();
  updateMiniPlayer();
}

function musicCycleMode() {
  const modes = ["list","single","shuffle"];
  const icons = ["🔁","🔂","🔀"];
  const labels = ["列表循环","单曲循环","随机播放"];
  const i = (modes.indexOf(musicMode) + 1) % modes.length;
  musicMode = modes[i];
  document.getElementById("mpModeBtn").textContent = icons[i];
  document.getElementById("mpModeBtn").title = labels[i];
  showToast(labels[i]);
}

function seekMusic(e) {
  if (!musicAudio || !musicAudio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  musicAudio.currentTime = pct * musicAudio.duration;
}

function updateMiniPlayer() {
  const mp = document.getElementById("miniPlayer");
  const isActive = musicCurrentIdx >= 0;
  mp.classList.toggle("active", isActive);
  if (musicCurrentIdx >= 0) {
    const track = musicPlaylist[musicCurrentIdx];
    document.getElementById("mpTitle").textContent = track ? track.name : "未知";
    document.getElementById("mpPlayBtn").textContent = musicPlaying ? "⏸" : "▶";
  }
}

function startProgressTimer() {
  if (musicProgressTimer) clearInterval(musicProgressTimer);
  musicProgressTimer = setInterval(() => {
    if (!musicAudio || !musicAudio.duration) return;
    const pct = (musicAudio.currentTime / musicAudio.duration) * 100;
    document.getElementById("mpProgress").style.width = pct + "%";
    document.getElementById("mpTime").textContent = formatSec(musicAudio.currentTime) + " / " + formatSec(musicAudio.duration);
  }, 500);
}

function formatSec(s) {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

// === Volume Control ===
function setMusicVolume(val) {
  musicVolume = parseInt(val) / 100;
  if (musicAudio) musicAudio.volume = musicVolume;
  try { localStorage.setItem("vbc_music_volume", val); } catch(e) {}
}

function stopMusic() {
  if (musicAudio) { musicAudio.pause(); musicAudio.src = ""; }
  musicPlaying = false;
  musicCurrentIdx = -1;
  updateMiniPlayer();
  if (document.getElementById("musicPanel").classList.contains("open")) renderMusicLibrary();
}

// === Bot Integration for Music ===
function shouldInjectMusicContext(text) {
  // History recall — always inject even if listen-together is off
  const recallKw = ["上次听","之前听","我们听过","一起听过","听了什么","放过什么","听歌记录","听过的歌"];
  if (recallKw.some(k => text.includes(k))) return true;

  if (!musicListenTogether) return false;
  // Active playback keywords
  const kw = ["切歌","换一首","下一首","上一首","换首","选一首","你来选","你来切","放一首",
    "这首歌","什么歌","在听什么","听什么歌","暂停","播放","继续播","一起听","听歌",
    "music","song","play","next","switch"];
  if (kw.some(k => text.toLowerCase().includes(k.toLowerCase()))) return true;
  // Also inject when actively playing (lightweight — just current song)
  return musicPlaying && musicCurrentIdx >= 0;
}

function buildMusicContext(userText) {
  let ctx = "\n\n<music-info>\n";

  // Current playback state
  if (musicListenTogether && (musicPlaying || musicCurrentIdx >= 0)) {
    ctx += "[一起听模式已开启]\n";
    if (musicCurrentIdx >= 0) {
      ctx += `正在播放：${musicPlaylist[musicCurrentIdx].name}（文件：${musicPlaylist[musicCurrentIdx].fileName}）\n`;
      ctx += `状态：${musicPlaying ? "播放中" : "已暂停"}\n`;
    } else {
      ctx += `当前没有在播放\n`;
    }

    // Full playlist (only when user seems to want song switching)
    const switchKw = ["切歌","换一首","下一首","选一首","你来选","你来切","放一首","换首","推荐","什么歌"];
    if (switchKw.some(k => userText.includes(k)) || !musicPlaying) {
      ctx += `歌单（共${musicPlaylist.length}首）：\n`;
      musicPlaylist.forEach((t, i) => {
        const marker = i === musicCurrentIdx ? " ◀当前" : "";
        ctx += `${i + 1}. ${t.name}（${t.fileName}）${marker}\n`;
      });
    }

    ctx += `\n切歌方法：在JSON回复中加 "music" 字段，值填歌曲名称（不需要后缀）。
比如歌单里有"周杰伦-晴天.mp3"，你写 "music":"周杰伦-晴天" 即可。
也可以用 "music":"next" 下一首、"music":"prev" 上一首。
只在【用户称呼代词】让你切歌、或你主动推荐时才加music字段。\n`;
  }

  // Current session summary
  if (musicSession.active && musicSession.tracksPlayed.length > 0) {
    ctx += `[这次听了] ${musicSession.tracksPlayed.join("、")}\n`;
  }

  // History
  const historyCtx = buildMusicHistoryContext();
  if (historyCtx) ctx += historyCtx;

  ctx += `</music-info>`;
  return ctx;
}

// Called from showMultipleMessages to handle bot music actions
function handleBotMusicAction(msg) {
  if (!msg.music) return;
  const action = msg.music.trim();
  if (action === "next") { musicNext(); appendMusicNotif("【角色名称】 切了一首歌 ⏭"); return; }
  if (action === "prev") { musicPrev(); appendMusicNotif("【角色名称】 切了上一首 ⏮"); return; }
  if (action === "pause") { if (musicAudio && musicPlaying) { musicAudio.pause(); musicPlaying = false; updateMiniPlayer(); } return; }
  if (action === "resume" || action === "play") { if (musicAudio && !musicPlaying) { musicAudio.play(); musicPlaying = true; updateMiniPlayer(); } return; }

  // Multi-level fuzzy matching
  const q = action.toLowerCase().replace(/\.\w+$/, ""); // strip extension
  let target = -1;

  // Level 1: exact fileName match
  target = musicPlaylist.findIndex(t => t.fileName.toLowerCase() === action.toLowerCase());
  // Level 2: exact name match (without extension)
  if (target < 0) target = musicPlaylist.findIndex(t => t.name.toLowerCase() === q);
  // Level 3: fileName or name contains query
  if (target < 0) target = musicPlaylist.findIndex(t =>
    t.fileName.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
  );
  // Level 4: query contains track name (bot wrote extra text around song name)
  if (target < 0) target = musicPlaylist.findIndex(t =>
    q.includes(t.name.toLowerCase()) && t.name.length >= 2
  );
  // Level 5: split on dash/space and match any segment
  if (target < 0) {
    const segments = q.split(/[-_\s]+/).filter(s => s.length >= 2);
    if (segments.length > 0) {
      target = musicPlaylist.findIndex(t => {
        const tn = t.name.toLowerCase();
        return segments.some(seg => tn.includes(seg));
      });
    }
  }

  if (target >= 0 && target !== musicCurrentIdx) {
    playTrack(target);
    appendMusicNotif(`【角色名称】 选了「${musicPlaylist[target].name}」🎵`);
  }
}

function appendMusicNotif(text) {
  const area = document.getElementById("chatArea");
  const div = document.createElement("div");
  div.className = "music-notif";
  div.textContent = text;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  // Also add to chatMessages for persistence
  chatMessages.push({ role: "system", text, time: Date.now(), isMusicNotif: true });
  saveChatHistory();
}

// === Save/Load ===
async function loadMusicFromMemory() {
  await loadMusicLibrary();
  // Load music history
  await loadMusicHistory();
  // Restore listen-together state from localStorage
  try {
    const saved = localStorage.getItem("vbc_music_listen_together");
    if (saved === "true") musicListenTogether = true;
  } catch(e) {}
}

// --- Session finalization (called on page close/hide) ---
function finalizeAndSaveMusicSession() {
  if (!musicSession.active) return;
  if (musicSession.tracksPlayed.length === 0) return;

  const session = {
    date: fmtD(new Date()),
    startTime: musicSession.startTime,
    endTime: Date.now(),
    tracks: [...musicSession.tracksPlayed]
  };

  const durationMin = Math.round((session.endTime - session.startTime) / 60000);
  const summary = "🎵 一起听回顾（" + (durationMin > 0 ? durationMin + "分钟" : "片刻") + "）：听了" + session.tracks.length + "首歌：" + session.tracks.join("、");

  chatMessages.push({ role: "system", text: summary, time: Date.now(), isMusicNotif: true });
  if (typeof imprintLogTurn === "function") imprintLogTurn("system", summary);

  musicHistory.push(session);
  if (musicHistory.length > 100) musicHistory = musicHistory.slice(-100);
  saveMusicHistory();

  musicSession = { active: false, startTime: null, tracksPlayed: [] };
  if (musicAudio) { musicAudio.pause(); musicPlaying = false; }
  updateMiniPlayer();
}

// --- Music history persistence ---
async function saveMusicHistory() {
  try { localStorage.setItem("vbc_music_history", JSON.stringify(musicHistory)); } catch(e) {}
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    const fh = await memoryDirHandle.getFileHandle("music-history.json", { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(musicHistory));
    await w.close();
  } catch(e) { console.warn("[Music] History save error:", e); }
}

async function loadMusicHistory() {
  // Memory library first
  if (memoryEnabled && memoryDirHandle) {
    try {
      const perm = await memoryDirHandle.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        const fh = await memoryDirHandle.getFileHandle("music-history.json");
        const f = await fh.getFile();
        musicHistory = JSON.parse(await f.text()) || [];
        console.log("[Music] Loaded history:", musicHistory.length, "sessions");
        return;
      }
    } catch(e) { /* doesn't exist yet */ }
  }
  // localStorage fallback
  try {
    const saved = localStorage.getItem("vbc_music_history");
    if (saved) musicHistory = JSON.parse(saved) || [];
  } catch(e) {}
}

// --- Bot recall: inject recent listening history ---
function buildMusicHistoryContext() {
  if (musicHistory.length === 0) return "";
  const recent = musicHistory.slice(-5); // last 5 sessions
  let ctx = "\n[最近一起听的记录]\n";
  for (const s of recent) {
    const d = s.date || "?";
    const trackList = (s.tracks && s.tracks.length) ? s.tracks.join("、") : "无";
    const dur = s.startTime && s.endTime ? Math.round((s.endTime - s.startTime) / 60000) + "分钟" : "";
    ctx += `${d}${dur ? "("+dur+")" : ""}：${trackList}\n`;
  }
  return ctx;
}
