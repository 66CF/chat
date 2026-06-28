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

  // Transcribe with MiMo ASR
  let text = "";
  if (mimoApiKey) {
    try {
      text = await transcribeWithMiMo(audioBlob);
    } catch(e) {
      console.warn("MiMo ASR failed:", e);
    }
  }

  // Update the voice message with transcribed text
  const textEl = document.getElementById(msgId + "-text");
  if (textEl) {
    textEl.textContent = text || (mimoApiKey ? "（未识别到文字）" : "（填写 MiMo API Key 可识别文字）");
    textEl.classList.remove("loading");
  }

  // Send to MiMo if we got text
  if (text) {
    isBusy = true;
    // Save voice message to chat history
    chatMessages.push({ role: "user", text, isVoice: true, voiceAudioId, duration, time: Date.now() });
    saveChatHistory();

    // Send to MiMo - build recall BEFORE pushing to history
    setLoading(true);
    document.getElementById("statusBar").textContent = "正在思考...";

    try {
      const systemPrompt = await prepareBotContext(text, text);
      // === Streaming + Parallel TTS ===
      // 使用共享的 streamWithTTS 函数
      const { rawText } = await streamWithTTS({
        system: systemPrompt,
        messages: getRecentMessages(),
        max_tokens: 128000
      });

      // Streaming handles display internally; just save reply
      await handleBotReply(rawText, { skipDisplay: true });

      document.getElementById("statusBar").textContent = "在线 · 语音已连接";

    } catch(err) {
      ErrorHandler.handle(err, 'voiceMessage', { showToast: true });
      setLoading(false);
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
async function encodeAudioToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioCtx.close();

  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const dataSize = length * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(audioBuffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function transcribeWithMiMo(blob) {
  const base64 = await encodeAudioToBase64(blob);
  const res = await fetch(MIMO_API_BASE + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + mimoApiKey
    },
    body: JSON.stringify({
      model: "mimo-v2.5-asr",
      messages: [{
        role: "user",
        content: [{
          type: "input_audio",
          input_audio: { data: `data:audio/wav;base64,${base64}` }
        }]
      }],
      asr_options: { language: "zh" }
    })
  });
  if (!res.ok) throw new Error("MiMo ASR error " + res.status);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

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
