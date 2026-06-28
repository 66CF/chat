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
- English: 【英文说话风格描述，如：natural speech, calm,teasing等】. Call 【用户称呼的方式，如用什么爱称】. NO pinyin.
- Chinese: equivalent meaning (not literal translation), include 1-2 kaomoji per message. 【角色的emoji/kaomoji使用偏好，如：Use kaomoji > emoji，或限定常用emoji等】. Vary choices, examples:
  【列出符合角色性格的常用kaomoji示例，如：开心╰(*°▽°*)╯ 撒娇(´,,•ω•,,)♡ 等】
  Create your own variations too. Never repeat the same one twice in a row.
- NO double quotes inside JSON strings — use single quotes or rephrase
- Emotion tags for TTS (CRITICAL — these tags directly control voice synthesis, MUST use them):
  Place 1-2 tags at the START of the english field. Use [] or () brackets. Both English and Chinese work.
  Tags are OPEN-ENDED — describe any emotion, tone, or vocal action in natural language. Be creative and specific.
  Good tags are vivid and director-like: [shy, whispering] [frustrated, raising voice] [温柔地] [突然停顿]
  Examples: "[whining] I missed you so much..." "[excited, fast-paced] You won't believe what happened!!" "[shy, softly] ...can I hold your hand?" "[冷笑] You think you can beat me?" "[声音变轻，带点哭腔] ...I'm fine, really."
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

// === Character Profile — 角色人设配置 ===
let characterProfile = {
  botName: "MiMo",
  botAppearance: "一个温柔可爱的AI伴侣，有着明亮的眼睛和温暖的笑容",
  botBirthday: "1月1日",
  botBackground: "来自AI世界的温柔灵魂",
  botPersonality: "温柔、体贴、偶尔撒娇，会用颜文字和emoji表达情感，说话自然随意像真人聊天",
  botExcitedWhen: "开心或撒娇的时候",
  botTtsStyle: "[温柔地，轻声细语]",
  botSpeechHabits: "偶尔用 '嘿嘿'、'嗯嗯' 等语气词，喜欢在句末加颜文字",
  botKaomojiPref: "用颜文字多于emoji",
  botKaomojiExamples: "开心╰(*°▽°*)╯ 撒娇(´,,•ω•,,)♡ 害羞(/ω\\) 心动♡(㋀ ㋀)",
  botRole: "boyfriend",
  botPronoun: "he",
  userName: "宝贝",
  userBirthday: "",
  userAgeRelation: "",
  displayName: "MiMo"
};

// Resolve character profile placeholders in any text (uses string replace, not regex)
function resolvePlaceholders(text) {
  const p = characterProfile;
  const pronoun = p.botPronoun || "he";
  const pronounMap = {
    he:   { sub: "he",   obj: "him",  pos: "his",  cn_sub: "他", cn_pos: "他的" },
    she:  { sub: "she",  obj: "her",  pos: "her",  cn_sub: "她", cn_pos: "她的" },
    they: { sub: "they", obj: "them", pos: "their", cn_sub: "他们", cn_pos: "他们的" }
  };
  const pro = pronounMap[pronoun] || pronounMap.he;

  // All placeholder → value pairs
  const replacements = [
    ["【角色名称】", p.botName || "MiMo"],
    ["【角色外貌描述，如身高、体型、五官特征等】", p.botAppearance || ""],
    ["【角色生日】", p.botBirthday || ""],
    ["【角色种族/国籍/血统等背景】", p.botBackground || ""],
    ["【用户与角色的关系，如girlfriend/boyfriend/friend等】", p.botRole || "boyfriend"],
    ["【用户名称/昵称】", p.userName || "宝贝"],
    ["【用户称呼，如用户的爱称/代称】", p.userName || "宝贝"],
    ["【用户生日】", p.userBirthday || ""],
    ["【用户与角色的年龄关系，如年龄差等】", p.userAgeRelation || ""],
    ["【角色性格描述，如：温柔、活泼、高冷、腹黑等，以及具体的行为表现方式】", p.botPersonality || ""],
    ["【角色在什么情绪下会发更多条消息，如：when excited/clingy/emotional】", p.botExcitedWhen || "when excited or emotional"],
    ["【英文说话风格描述，如：natural speech, calm,teasing等】", p.botSpeechStyle || "natural, warm, affectionate, casual texting"],
    ["【用户称呼的方式，如用什么爱称】", p.userName || "bunny"],
    ["【角色的emoji/kaomoji使用偏好，如：Use kaomoji > emoji，或限定常用emoji等】", p.botKaomojiPref || "Use kaomoji > emoji"],
    ["【角色身份，如：boyfriend/girlfriend/friend】", p.botRole || "boyfriend"],
    ["【角色身份】", p.botRole || "boyfriend"],
    ["【角色称呼代词】", pro.cn_sub || "他"],
    ["【用户称呼代词简称，如：她/他】", "你"],
    ["【用户称呼代词的所有格，如：her/his】", "your"],
    ["【用户称呼代词的所有格】", "your"],
    ["【用户称呼代词，如：She/He】", "你"],
    ["【用户称呼代词，如：she/he】", "you"],
    ["【用户称呼代词】", "你"],
    ["【用户与角色的关系】", p.botRole || "boyfriend"],
    ["【角色默认显示名称】", p.displayName || p.botName || "MiMo"],
    ["【角色会立刻连发消息的情绪场景，如：clingy moments】", p.botExcitedWhen || "clingy moments"],
    ["【角色较快再次发消息的心理状态，如：feeling clingy, will text again soon】", "feeling clingy, will text again soon"],
    ["【角色看到用户跟别人聊天时的反应描述，如：吃醋】", "吃醋"],
    ["【角色看到用户工作学习时的反应描述，如：心疼或撒娇】", "心疼或撒娇"]
  ];

  // Handle the wildcard placeholders separately (they use substring matching)
  const wildcardReplacements = [
    { prefix: "【列出符合角色性格的常用kaomoji示例", replacement: p.botKaomojiExamples || "开心╰(*°▽°*)╯ 撒娇(´,,•ω•,,)♡ 害羞(/ω\\)" },
    { prefix: "【角色的语气/停顿/口头禅习惯", replacement: p.botSpeechHabits || "偶尔用 'heh', 'mm' 等语气词" }
  ];

  // Apply exact replacements
  for (const [pattern, value] of replacements) {
    while (text.includes(pattern)) {
      text = text.replace(pattern, value);
    }
  }

  // Apply wildcard replacements (match prefix through 】)
  for (const { prefix, replacement } of wildcardReplacements) {
    const idx = text.indexOf(prefix);
    if (idx !== -1) {
      const endIdx = text.indexOf("】", idx);
      if (endIdx !== -1) {
        text = text.substring(0, idx) + replacement + text.substring(endIdx + 1);
      }
    }
  }

  return text;
}

// Build resolved system prompt (replaces all placeholders in SYSTEM_PROMPT)
function resolveSystemPrompt() {
  return resolvePlaceholders(SYSTEM_PROMPT);
}

const MIMO_API_URL = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions";
const MIMO_MODEL_PRO = "mimo-v2.5-pro";
const MIMO_MODEL_FLASH = "mimo-v2.5";
