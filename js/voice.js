// === Voice Input (MediaRecorder + Hold-to-Talk) ===
let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let voiceAutoPlayUser = false; // user voice auto-play toggle
let isVoiceMode = false;
let recStartTime = null;
let recTimerInterval = null;
let cancelledBySwipe = false;

// Call mode state
let isInCall = false;
let callTimerInterval = null;
let callStartTime = null;
let callWaiting = false;
let silenceTimer = null;
let audioContext = null;
let analyser = null;
let vadInterval = null;

// Pre-request mic at chat start (only prompt once)
async function initMicStream() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  } catch(e) {
    console.warn("Mic init failed:", e);
    document.getElementById("statusBar").textContent = "⚠️ 麦克风未授权，语音功能不可用";
  }
}

// === Input Mode Toggle ===
function toggleInputMode() {
  isVoiceMode = !isVoiceMode;
  const modeBtn = document.getElementById("modeBtn");
  const chatInput = document.getElementById("chatInput");
  const holdBtn = document.getElementById("holdToTalk");
  const sendBtn = document.getElementById("sendBtn");

  if (isVoiceMode) {
    modeBtn.textContent = "⌨️";
    chatInput.style.display = "none";
    holdBtn.style.display = "block";
    sendBtn.style.display = "none";
    document.getElementById("voiceAutoPlayToggle").style.display = "block";
  } else {
    modeBtn.textContent = "🎤";
    chatInput.style.display = "block";
    holdBtn.style.display = "none";
    sendBtn.style.display = "block";
    chatInput.focus();
    document.getElementById("voiceAutoPlayToggle").style.display = "none";
  }
}

function toggleVoiceAutoPlay() {
  voiceAutoPlayUser = !voiceAutoPlayUser;
  const el = document.getElementById("voiceAutoPlayToggle");
  el.textContent = voiceAutoPlayUser ? "🔊 自动播放:开" : "🔇 自动播放:关";
  el.style.borderColor = voiceAutoPlayUser ? "var(--accent)" : "var(--border)";
  el.style.color = voiceAutoPlayUser ? "var(--accent)" : "var(--text-dim)";
  try { localStorage.setItem("vbc_voice_autoplay", voiceAutoPlayUser ? "1" : "0"); } catch(e) {}
}

// === Hold to Talk ===
function startVoiceRecord(e) {
  e.preventDefault();
  if (!mediaStream) {
    initMicStream();
    return;
  }
  cancelledBySwipe = false;
  audioChunks = [];
  recStartTime = Date.now();

  try {
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) audioChunks.push(ev.data);
    };
    mediaRecorder.start(200);
    isRecording = true;

    // Show recording UI
    document.getElementById("holdToTalk").classList.add("recording");
    document.getElementById("holdToTalk").textContent = "松开 发送";
    const hint = document.getElementById("recordingHint");
    hint.classList.add("visible");
    updateRecTime();
    recTimerInterval = setInterval(updateRecTime, 1000);
  } catch(e) {
    console.error("Record start error:", e);
  }
}

async function stopVoiceRecord() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  clearInterval(recTimerInterval);

  document.getElementById("holdToTalk").classList.remove("recording");
  document.getElementById("holdToTalk").textContent = "按住 说话";
  document.getElementById("recordingHint").classList.remove("visible");

  if (cancelledBySwipe) {
    mediaRecorder.stop();
    return;
  }

  const duration = ((Date.now() - recStartTime) / 1000).toFixed(1);
  if (duration < 0.5) {
    mediaRecorder.stop();
    return; // Too short
  }

  // Stop and get blob
  const audioBlob = await new Promise(resolve => {
    mediaRecorder.onstop = () => resolve(new Blob(audioChunks, { type: "audio/webm" }));
    mediaRecorder.stop();
  });

  // Remove empty state
  const empty = document.getElementById("emptyState");
  if (empty) empty.remove();

  // Create audio URL and save to IndexedDB
  const audioUrl = URL.createObjectURL(audioBlob);
  const voiceAudioId = "voice_" + Date.now();
  await AudioDB.save(voiceAudioId, audioBlob);

  // Show user voice message immediately (with "识别中..." placeholder)
  const msgId = "vmsg_" + Date.now();
  appendVoiceMessage(msgId, audioUrl, duration, "", voiceAudioId);

  // Play back the user's own recording (only if auto-play is enabled)
  if (voiceAutoPlayUser) {
    playVoiceMsg(document.getElementById(msgId + "-player"), audioUrl);
  }

  // Transcribe with Whisper (requires OpenAI Key)
  let text = "";
  if (openaiApiKey) {
    try {
      text = await transcribeWithWhisper(audioBlob);
    } catch(e) {
      console.warn("Whisper failed:", e);
    }
  }

  // Update the voice message with transcribed text
  const textEl = document.getElementById(msgId + "-text");
  if (textEl) {
    textEl.textContent = text || (openaiApiKey ? "（未识别到文字）" : "（填写 OpenAI Key 可识别文字）");
    textEl.classList.remove("loading");
  }

  // Send to Claude if we got text
  if (text) {
    isBusy = true;
    // Save voice message to chat history
    chatMessages.push({ role: "user", text, isVoice: true, voiceAudioId, duration, time: Date.now() });
    saveChatHistory();

    // Send to Claude - build recall BEFORE pushing to history
    setLoading(true);
    document.getElementById("statusBar").textContent = "正在思考...";

    try {
      const systemPrompt = await buildSystemWithRecall(text);
      conversationHistory.push({ role: "user", content: text });
      imprintLogTurn("user", text);
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": claudeApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: safeStringify({
          model: chatModel, max_tokens: 650,
          ...(webSearchEnabled ? {tools:[{type:"web_search_20250305",name:"web_search"}]} : {}),
          system: systemPrompt, messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim()))
        })
      });

      if (!claudeRes.ok) {
        const et = await claudeRes.text().catch(()=>"");
        if (et.includes("content filtering") || et.includes("blocked")) {
          setLoading(false);
          const fb = getRandomLyricFallback();
          conversationHistory.push({ role: "assistant", content: safeStringify(fb) });
          await showMultipleMessages(fb);
          document.getElementById("statusBar").textContent = "在线 · 语音已连接";
          isBusy = false; return;
        }
        throw new Error("Claude API 错误 (" + claudeRes.status + "): " + (et || "").slice(0, 200));
      }
      const claudeData = await claudeRes.json();
      const rawText = claudeData.content.filter(c => c.type === "text" && c.text).map(c => c.text).pop() || "";
      const messages = parseClaudeResponse(rawText);
      conversationHistory.push({ role: "assistant", content: rawText });
      imprintLogTurn("assistant", rawText);

      document.getElementById("statusBar").textContent = "正在生成语音...";
      setLoading(false);
      await showMultipleMessages(messages);
      document.getElementById("statusBar").textContent = "在线 · 语音已连接";

    } catch(err) {
      setLoading(false);
      showError(err.message);
      document.getElementById("statusBar").textContent = "在线 · 语音已连接";
    }
    isBusy = false;
  } else {
    // No text recognized, just save the voice
    chatMessages.push({ role: "user", text: "[语音消息]", isVoice: true, voiceAudioId, duration, time: Date.now() });
    saveChatHistory();
  }
}

function cancelVoiceCheck() {
  if (isRecording) {
    cancelledBySwipe = true;
    stopVoiceRecord();
    document.getElementById("holdToTalk").textContent = "按住 说话";
  }
}

function updateRecTime() {
  if (!recStartTime) return;
  const s = Math.floor((Date.now() - recStartTime) / 1000);
  document.getElementById("recTime").textContent =
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// === Transcription ===
async function transcribeWithWhisper(blob) {
  const fd = new FormData();
  fd.append("file", blob, "audio.webm");
  fd.append("model", "whisper-1");
  fd.append("language", "zh");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiApiKey}` },
    body: fd
  });
  if (!res.ok) throw new Error("Whisper error " + res.status);
  return ((await res.json()).text || "").trim();
}

// === Transcription (Whisper only) ===

// === Voice Message UI ===
function appendVoiceMessage(msgId, audioUrl, duration, text, voiceAudioId, restored, time) {
  const ts = time || Date.now();
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row user";

  const bars = Array(6).fill(0).map(() => {
    const h = 4 + Math.random() * 12;
    return `<div class="voice-bar" style="height:${h}px"></div>`;
  }).join("");

  const textContent = restored
    ? escapeHtml(text || "[语音消息]")
    : '<span class="loading">识别中...</span>';

  const clickHandler = audioUrl
    ? `playVoiceMsg(this, '${audioUrl}')`
    : `playVoiceFromDB(this, '${voiceAudioId}')`;

  row.innerHTML = `
    
    <div class="bubble user voice-bubble">
      <div class="voice-player" id="${msgId}-player" onclick="${clickHandler}">
        <span class="play-icon">▶</span>
        <div class="voice-bars">${bars}</div>
        <span class="voice-dur">${duration}″</span>
      </div>
      <div class="voice-text${restored ? '' : ' loading'}" id="${msgId}-text">${textContent}</div>
    </div>
    <div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

async function playVoiceFromDB(playerEl, audioId) {
  const blob = await AudioDB.load(audioId);
  if (!blob) {
    playerEl.querySelector(".play-icon").textContent = "✕";
    return;
  }
  const url = URL.createObjectURL(blob);
  playerEl.setAttribute("onclick", `playVoiceMsg(this, '${url}')`);
  playVoiceMsg(playerEl, url);
}

function playVoiceMsg(playerEl, url) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  // Remove playing state from all players
  document.querySelectorAll(".voice-player.playing").forEach(p => {
    p.classList.remove("playing");
    p.querySelector(".play-icon").textContent = "▶";
  });

  const audio = new Audio(url);
  currentAudio = audio;
  playerEl.classList.add("playing");
  playerEl.querySelector(".play-icon").textContent = "⏸";
  audio.onended = () => {
    playerEl.classList.remove("playing");
    playerEl.querySelector(".play-icon").textContent = "▶";
    currentAudio = null;
  };
  audio.onerror = () => {
    playerEl.classList.remove("playing");
    playerEl.querySelector(".play-icon").textContent = "▶";
  };
  audio.play().catch(() => {});
}

// === Voice Call Mode ===
function syncCallPageAvatar() {
  // Sync name
  const name = document.getElementById("headerName").textContent;
  document.getElementById("callName").textContent = name;
  // Sync avatar
  const callAv = document.getElementById("callAvatar");
  if (customAvatarUrl) {
    callAv.innerHTML = `<img src="${customAvatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    callAv.innerHTML = "♡";
  }
}

function toggleCall() {
  isInCall ? endCall() : startCall();
}

function setupVAD(stream) {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(stream).connect(analyser);
}

function checkSilence() {
  if (!analyser || !isInCall || callWaiting) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
  const isSilent = Math.sqrt(sum / data.length) < 0.015;

  if (!isSilent) {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  } else if (mediaRecorder && mediaRecorder.state === "recording" && audioChunks.length > 0) {
    if (!silenceTimer) {
      silenceTimer = setTimeout(() => {
        silenceTimer = null;
        if (isInCall && !callWaiting && mediaRecorder && mediaRecorder.state === "recording")
          mediaRecorder.stop();
      }, 1500);
    }
  }
}

async function startCall() {
  if (!mediaStream) {
    alert("麦克风未授权，请刷新页面重试");
    return;
  }
  if (!openaiApiKey) {
    alert("语音通话需要填写 OpenAI API Key 用于语音识别");
    return;
  }
  if (isRecording) cancelVoiceCheck();
  setupVAD(mediaStream);

  isInCall = true;
  callWaiting = false;
  callStartTime = Date.now();

  document.getElementById("callBtn").classList.add("in-call");
  document.getElementById("callBtn").textContent = "📞 通话中";
  syncCallPageAvatar();
  document.getElementById("callOverlay").classList.remove("hidden");
  document.getElementById("callStatus").textContent = "正在聆听...";
  document.getElementById("callTranscript").innerHTML = "";
  document.getElementById("callSubtitle").classList.remove("visible");
  setCallAvatarState("listening");

  callTimerInterval = setInterval(updateCallTimer, 1000);
  updateCallTimer();
  vadInterval = setInterval(checkSilence, 100);
  startListeningInCall();
}

function endCall() {
  isInCall = false;
  callWaiting = false;
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.onstop = () => {};
    mediaRecorder.stop();
  }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  if (vadInterval) { clearInterval(vadInterval); vadInterval = null; }
  clearInterval(callTimerInterval);

  document.getElementById("callOverlay").classList.add("hidden");
  document.getElementById("callBtn").classList.remove("in-call");
  document.getElementById("callBtn").textContent = "📞 通话";
  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
}

async function startListeningInCall() {
  if (!isInCall || callWaiting) return;
  document.getElementById("callStatus").textContent = "正在聆听...";
  document.getElementById("callTranscript").innerHTML = `<span style="color:#555">说点什么吧...</span>`;
  setCallAvatarState("listening");

  try {
    audioChunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      if (!isInCall) return;
      if (audioChunks.length === 0) { if (isInCall && !callWaiting) setTimeout(startListeningInCall, 500); return; }
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      audioChunks = [];
      document.getElementById("callStatus").textContent = "🔄 识别中...";
      try {
        const text = await transcribeWithWhisper(audioBlob);
        if (text && isInCall) handleCallMessage(text);
        else if (isInCall && !callWaiting) startListeningInCall();
      } catch(e) {
        document.getElementById("callStatus").textContent = "识别失败，继续聆听...";
        if (isInCall && !callWaiting) setTimeout(startListeningInCall, 1000);
      }
    };
    mediaRecorder.start(250);
  } catch(e) {
    if (isInCall) setTimeout(startListeningInCall, 1000);
  }
}

async function handleCallMessage(text) {
  callWaiting = true;
  isBusy = true;
  setCallAvatarState("thinking");
  document.getElementById("callStatus").textContent = "正在思考...";
  document.getElementById("callTranscript").innerHTML =
    `<span class="you">你: ${escapeHtml(text)}</span>`;

  const empty = document.getElementById("emptyState");
  if (empty) empty.remove();
  appendMessage("user", text, true);

  try {
    const systemPrompt = await buildSystemWithRecall(text);
    conversationHistory.push({ role: "user", content: text });
    imprintLogTurn("user", text);
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": claudeApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: safeStringify({
        model: chatModel, max_tokens: 650,
          ...(webSearchEnabled ? {tools:[{type:"web_search_20250305",name:"web_search"}]} : {}),
        system: systemPrompt, messages: conversationHistory.slice(-20).filter(m => m.content && (typeof m.content !== "string" || m.content.trim()))
      })
    });

    if (!claudeRes.ok) {
      const et = await claudeRes.text().catch(()=>"");
      if (et.includes("content filtering") || et.includes("blocked")) {
        const fb = getRandomLyricFallback();
        conversationHistory.push({ role: "assistant", content: safeStringify(fb) });
        document.getElementById("callStatus").textContent = "正在说话...";
        setCallAvatarState("speaking");
        for (const m of fb) appendBotMessage(m.english, m.chinese, null, true, null);
        isBusy = false;
        if (isInCall) { callWaiting = false; startListeningInCall(); }
        return;
      }
      throw new Error("Claude API error (" + claudeRes.status + "): " + (et || "").slice(0, 200));
    }
    const claudeData = await claudeRes.json();
    const rawText = claudeData.content.filter(c => c.type === "text" && c.text).map(c => c.text).pop() || "";
    const messages = parseClaudeResponse(rawText);
    conversationHistory.push({ role: "assistant", content: rawText });
    imprintLogTurn("assistant", rawText);

    const subtitle = document.getElementById("callSubtitle");
    document.getElementById("callStatus").textContent = "正在说话...";
    setCallAvatarState("speaking");

    // Play each message sequentially in call mode
    for (const msg of messages) {
      subtitle.textContent = cleanTags(msg.chinese);
      subtitle.classList.add("visible");
      document.getElementById("callTranscript").innerHTML =
        `<span class="him">${escapeHtml(cleanTags(msg.chinese))}</span>`;

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
          savedAudioId = "audio_" + Date.now();
          await AudioDB.save(savedAudioId, ab);
        }
      } catch(e) {}

      appendBotMessage(msg.english, msg.chinese, audioUrl, true, savedAudioId);

      if (audioUrl && isInCall) {
        await new Promise(resolve => {
          const audio = new Audio(audioUrl);
          currentAudio = audio;
          audio.onended = () => { currentAudio = null; resolve(); };
          audio.onerror = () => { currentAudio = null; resolve(); };
          audio.play().catch(resolve);
        });
      }
    }

    const resumeListening = () => {
      subtitle.classList.remove("visible");
      isBusy = false;
      if (isInCall) { callWaiting = false; startListeningInCall(); }
    };
    resumeListening();

  } catch(err) {
    console.error("Call error:", err);
    document.getElementById("callStatus").textContent = "出错了，继续聆听...";
    isBusy = false;
    if (isInCall) { callWaiting = false; setTimeout(startListeningInCall, 1500); }
  }
}

function setCallAvatarState(state) {
  const avatar = document.getElementById("callAvatar");
  avatar.classList.remove("listening", "thinking", "speaking");
  avatar.classList.add(state);
}

function updateCallTimer() {
  if (!callStartTime) return;
  const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  document.getElementById("callTimer").textContent = `${m}:${s}`;
}

