// === TTS Style Extraction ===
// Extract emotion/style tags from English text to build TTS style instruction
// Tags like [whining], [excited], [softly], (laughing), etc.
function extractTTSStyleHints(text) {
  const tags = [];
  const tagRegex = /[\[（(]([^)\]）]+)[\]）)]/g;
  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const tag = match[1].trim().toLowerCase();
    // Skip singing tags and very long tags (likely not emotion tags)
    if (tag.length > 0 && tag.length < 50 && !/^sing/i.test(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

// Build a natural language style instruction for TTS from extracted tags
function buildTTSStyleInstruction(english) {
  const hints = extractTTSStyleHints(english);
  if (hints.length === 0) return null;
  // Deduplicate
  const unique = [...new Set(hints)];
  return `Speak with ${unique.join(", ")} tone and expression.`;
}

// === TTS Helper: fetch TTS for a single message (streaming PCM16 → WAV) ===
async function fetchTTSForMessage(english, index, options = {}) {
  const voice = options.voice || MIMO_TTS_VOICE;
  try {
    // Build messages array — assistant content is the text to synthesize
    const ttsMessages = [];

    // Add user role with style instruction (v2.5 TTS supports this for tone control)
    const styleInstruction = buildTTSStyleInstruction(english);
    if (styleInstruction) {
      ttsMessages.push({ role: "user", content: styleInstruction });
    }

    // Clean English text: remove *action* descriptions but keep [audio tags] for TTS
    const ttsText = (english || "").replace(/\*[^*]+\*\s*/g, "").replace(/\s{2,}/g, " ").trim();
    ttsMessages.push({ role: "assistant", content: ttsText || english });

    const ttsRes = await fetch(MIMO_API_BASE + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + mimoApiKey },
      body: safeStringify({
        model: MIMO_TTS_MODEL,
        messages: ttsMessages,
        audio: { format: "pcm16", voice: voice },
        stream: true
      })
    });
    if (!ttsRes.ok) { console.error("MiMo TTS error:", ttsRes.status); return { audioUrl: null, savedAudioId: null }; }

    // Collect PCM16 chunks from SSE stream
    const reader = ttsRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const pcmChunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const chunk = JSON.parse(trimmed.slice(6));
            const audioData = chunk.choices?.[0]?.delta?.audio?.data;
            if (audioData) {
              const pcmBytes = atob(audioData);
              const pcmArr = new Uint8Array(pcmBytes.length);
              for (let k = 0; k < pcmBytes.length; k++) pcmArr[k] = pcmBytes.charCodeAt(k);
              pcmChunks.push(pcmArr);
            }
          } catch(e) {}
        }
      }
    }

    if (pcmChunks.length === 0) return { audioUrl: null, savedAudioId: null };

    // Concatenate all PCM16 chunks
    const totalLen = pcmChunks.reduce((s, c) => s + c.length, 0);
    const pcmData = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of pcmChunks) { pcmData.set(chunk, offset); offset += chunk.length; }

    // Build WAV file (24kHz, 16-bit, mono)
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const wavBuffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(wavBuffer);
    function writeStr(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcmData.length, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, "data");
    view.setUint32(40, pcmData.length, true);
    new Uint8Array(wavBuffer, 44).set(pcmData);

    const ab = new Blob([wavBuffer], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(ab);
    const savedAudioId = "audio_" + Date.now() + "_" + index;
    AudioDB.save(savedAudioId, ab).catch(e => console.warn("DB save error:", e));
    return { audioUrl, savedAudioId };
  } catch(e) { console.warn("TTS error for msg", index, e); }
  return { audioUrl: null, savedAudioId: null };
}

async function showMultipleMessages(messages, ttsPrefetch) {
  // ttsPrefetch: optional Map<index, Promise<{audioUrl, savedAudioId}>>
  //   pre-fired TTS promises (from streaming mode). If provided, we reuse them.

  // Fire all TTS requests in parallel (for any not already prefetched)
  const ttsPromises = messages.map((msg, i) => {
    if (ttsPrefetch && ttsPrefetch.has(i)) return ttsPrefetch.get(i);
    return fetchTTSForMessage(msg.english, i);
  });

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Reduced typing delay (parallel TTS means TTS is likely already done)
    if (i > 0) await new Promise(r => setTimeout(r, 300 + Math.random() * 200));

    // Wait for this message's TTS (should already be resolved in most cases)
    const { audioUrl, savedAudioId } = await ttsPromises[i];

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
