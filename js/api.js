// === MiMo API Functions ===
// Depends on: config.js (MIMO_API_URL, MIMO_API_BASE, MIMO_MODEL_PRO, MIMO_MODEL_FLASH, mimoApiKey)
// Depends on: storage.js (safeStringify)

async function callMiMoAPI(options) {
  const { system, messages, model, tools } = options;
  let { max_tokens = 128000 } = options;
  const apiMessages = [];
  if (system) apiMessages.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.content && (typeof m.content !== "string" || m.content.trim())) {
      apiMessages.push(m);
    }
  }
  let useModel = model || (typeof chatModel !== "undefined" ? chatModel : MIMO_MODEL_PRO);
  const hasImage = apiMessages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image_url"));
  if (hasImage && useModel === MIMO_MODEL_PRO) useModel = MIMO_MODEL_FLASH;
  if (hasImage && max_tokens < 2000) max_tokens = 2000;
  const body = {
    model: useModel,
    max_tokens,
    messages: apiMessages
  };
  if (tools && tools.length > 0) body.tools = tools;
  const res = await fetch(MIMO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + mimoApiKey
    },
    body: safeStringify(body)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error("MiMo API 错误 (" + res.status + "): " + (errText || "").slice(0, 200));
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  const content = msg?.content;
  if (!content) {
    if (msg?.reasoning_content) {
      console.warn("Model returned reasoning only, no content. Reasoning:", msg.reasoning_content.slice(0, 300));
      throw new Error("模型只返回了推理过程，未生成回复");
    }
    console.warn("API response:", JSON.stringify(data).slice(0, 1000));
    throw new Error("API 返回无内容");
  }
  return content;
}

function extractTextFromResponse(data) {
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content || "";
  }
  return "";
}

// === Streaming API (SSE) — for call mode speed optimization ===
async function callMiMoAPIStream(options) {
  const { system, messages, model, tools, onChunk } = options;
  let { max_tokens = 128000 } = options;
  const apiMessages = [];
  if (system) apiMessages.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.content && (typeof m.content !== "string" || m.content.trim())) {
      apiMessages.push(m);
    }
  }
  let useModel = model || (typeof chatModel !== "undefined" ? chatModel : MIMO_MODEL_PRO);
  const hasImage = apiMessages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === "image_url"));
  if (hasImage && useModel === MIMO_MODEL_PRO) useModel = MIMO_MODEL_FLASH;
  if (hasImage && max_tokens < 2000) max_tokens = 2000;
  const body = {
    model: useModel,
    max_tokens,
    messages: apiMessages,
    stream: true
  };
  if (tools && tools.length > 0) body.tools = tools;

  const res = await fetch(MIMO_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + mimoApiKey
    },
    body: safeStringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error("MiMo API 错误 (" + res.status + "): " + (errText || "").slice(0, 200));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  function handleSSELine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(":")) return;
    if (trimmed === "data: [DONE]") return;

    if (trimmed.startsWith("data: ")) {
      try {
        const chunk = JSON.parse(trimmed.slice(6));
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          accumulated += delta.content;
          if (onChunk) onChunk(accumulated);
        }
      } catch(e) {}
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) handleSSELine(buffer);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      handleSSELine(line);
    }
  }

  return accumulated;
}

// Extract complete JSON objects from partial stream (string-aware brace tracking)
function extractCompleteMessages(text) {
  const messages = [];
  let s = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  const arrStart = s.indexOf("[");
  if (arrStart === -1) return messages;
  s = s.substring(arrStart + 1);

  let inString = false;
  let escaped = false;
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (c === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          const obj = JSON.parse(s.slice(objStart, i + 1));
          if (obj.english !== undefined && obj.chinese !== undefined) {
            messages.push(obj);
          }
        } catch(e) {}
        objStart = -1;
      }
    }
  }

  return messages;
}

// Extract english text from messages where the "english" field value is fully closed
// in the stream, even if the rest of the JSON object ("chinese", etc.) hasn't arrived yet.
// This allows TTS to fire earlier — as soon as the english sentence is complete.
function extractReadyEnglish(text) {
  const messages = [];
  let s = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const arrStart = s.indexOf("[");
  if (arrStart === -1) return messages;
  s = s.substring(arrStart + 1);

  // Match {"english":"<value>"  — the closing " proves the english field is complete
  const regex = /\{\s*"english"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = regex.exec(s)) !== null) {
    // Unescape JSON string escapes (\" → ", \\ → \)
    messages.push(match[1].replace(/\\(.)/g, "$1"));
  }
  return messages;
}
