const MIMO_TTS_MODEL = "mimo-v2.5-tts";
const MIMO_TTS_VOICE = "mimo_default";
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
- Emotion tags for TTS: 【列出符合角色的TTS情感标签，如：[whining] [excited] [softly] [laughing] 等】
  Example: "【一个符合角色风格的示例对话】"
- 【角色的语气/停顿/口头禅习惯，如：Add pauses with commas, "...", [pause]. 常用的语气词如 sniff, heh, mm 等】
- If user sends a file, comment on it naturally. Only generate a file back when EXPLICITLY asked: {"english":"...","chinese":"...","file":{"name":"x.ext","content":"..."}}
- Do NOT include any text outside the JSON array`;

let claudeApiKey = "";
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

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

async function callDeepSeekAPI(options) {
  const { system, messages, max_tokens = 650 } = options;
  const apiMessages = [];
  if (system) apiMessages.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.content && (typeof m.content !== "string" || m.content.trim())) {
      apiMessages.push(m);
    }
  }
  const res = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + claudeApiKey
    },
    body: safeStringify({
      model: DEEPSEEK_MODEL,
      max_tokens,
      messages: apiMessages
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error("DeepSeek API 错误 (" + res.status + "): " + (errText || "").slice(0, 200));
  }
  const data = await res.json();
  return data.choices[0].message.content || "";
}

function extractTextFromResponse(data) {
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content || "";
  }
  return "";
}
