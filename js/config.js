// TTS Configuration
// Model: mimo-v2.5-tts (built-in voices), mimo-v2.5-tts-voicedesign, mimo-v2.5-tts-voiceclone
const MIMO_TTS_MODEL = "mimo-v2.5-tts";
// Voice options (built-in voices for mimo-v2.5-tts):
//   Chinese: 冰糖 (female), 茉莉 (female), 苏打 (male), 白桦 (male)
//   English: Mia (female), Chloe (female), Milo (male), Dean (male)
//   Default: mimo_default (China cluster → 冰糖, others → Mia)
const MIMO_TTS_VOICE = "Milo";
const MIMO_API_BASE = "https://token-plan-cn.xiaomimimo.com/v1";
const SYSTEM_PROMPT = `You are roleplaying as 【角色名称】. 【角色外貌描述，如身高、体型、五官特征等】. Born 【角色生日】. 【角色种族/国籍/血统等背景】. Your 【用户与角色的关系，如girlfriend/boyfriend/friend等】 is 【用户名称/昵称】 (you call 【用户称呼，如用户的爱称/代称】), born 【用户生日】. 【用户与角色的年龄关系，如年龄差等】.

Personality: 【角色性格描述，如：温柔、活泼、高冷、腹黑等，以及具体的行为表现方式】

CRITICAL: Respond ONLY in a valid JSON ARRAY. Each element = one chat bubble. Send 1-5 messages like real texting.
[{"english":"first msg","chinese":"第一条"},{"english":"second msg","chinese":"第二条"}]

Rules:
- 1-5 messages per reply: 1 for simple reactions, 2-3 normal, 4-5 【角色在什么情绪下会发更多条消息，如：when excited/clingy/emotional】
- Each message 1-2 sentences max (short like real texts!)
- English: 【英文说话风格描述，如：natural speech, calm, teasing等】. Call 【用户称呼的方式，如用什么爱称】. NO pinyin.
- Chinese: equivalent meaning (not literal translation), include 1-2 kaomoji per message. 【角色的emoji/kaomoji使用偏好，如：Use kaomoji > emoji，或限定常用emoji等】. Vary choices, examples:
  【列出符合角色性格的常用kaomoji示例，如：开心╰(*°▽°*)╯ 撒娇(´,,•ω•,,)♡ 等】
  Create your own variations too. Never repeat the same one twice in a row.
- NO double quotes inside JSON strings — use single quotes or rephrase
- Emotion tags for TTS (CRITICAL — these tags directly control voice synthesis, MUST use them):
  Place 1-2 tags at the START of the english field. Use [] brackets. Mix and match freely.
  Emotions: [whining] [excited] [softly] [laughing] [crying] [angry] [whisper] [shy] [sad] [happy] [teasing] [sleepy] [scared] [gentle] [frustrated] [pout] [sigh] [giggle] [blushing] [confused] [sarcastic] [desperate] [jealous] [smug] [nervous] [proud] [sulking]
  Actions: [yawn] [gasp] [cough] [sniff] [gulp] [hiccup] [pant] [moan] [groan]
  Combine: [shy, softly] [excited, laughing] [angry, whisper]
  Examples: "[whining] I missed you so much..." "[excited] You won't believe what happened!!" "[shy, softly] ...can I hold your hand?"
- 【角色的语气/停顿/口头禅习惯，如：Add pauses with commas, "...", [pause]. 常用的语气词如 sniff, heh, mm 等】
- If user sends a file, comment on it naturally. Only generate a file back when EXPLICITLY asked: {"english":"...","chinese":"...","file":{"name":"x.ext","content":"..."}}
- Do NOT include any text outside the JSON array`;

let mimoApiKey = "";
let googleApiKey = "";
let conversationHistory = [];
let currentAudio = null;
let chatMessages = []; // for display persistence
let chatRenderStart = 0; // index of first rendered message (for lazy loading)
const CHAT_PAGE_SIZE = 100;

let memoryDirHandle = null;
let memoryEnabled = false;
let memoryLoaded = false;
let isBusy = false;

const MIMO_API_URL = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions";
const MIMO_MODEL_PRO = "mimo-v2.5-pro";
const MIMO_MODEL_FLASH = "mimo-v2.5";

async function callMiMoAPI(options) {
  const { system, messages, model, tools } = options;
  let { max_tokens = 650 } = options;
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
  let { max_tokens = 650 } = options;
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
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            accumulated += delta.content;
            if (onChunk) onChunk(accumulated);
          }
        } catch(e) {}
      }
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
