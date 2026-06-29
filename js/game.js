// === Game System (小游戏) ===
let currentGame = null; // null | { type, ...state }

function toggleGamePanel() {
  document.getElementById("gamePanel").classList.toggle("open");
  document.getElementById("gameOverlay").classList.toggle("open");
}

function updateGameBanner() {
  const banner = document.getElementById("gameBanner");
  const text = document.getElementById("gameBannerText");
  const actionBtn = banner.querySelector("button:not(.danger)");
  if (!currentGame) {
    banner.classList.remove("active");
    saveChatHistory();
    return;
  }
  banner.classList.add("active");
  const labels = {
    turtle_soup: "🐢🍲 海龟汤进行中",
    truth_dare: "🎯 真心话大冒险",
    story_relay: "📖 故事接龙中",
    cooking: "🍳 一起做饭中"
  };
  text.textContent = labels[currentGame.type] || "游戏中";
  if (currentGame.type === "turtle_soup") {
    actionBtn.textContent = "揭晓答案";
    actionBtn.style.display = "";
  } else if (currentGame.type === "truth_dare") {
    actionBtn.textContent = "下一轮";
    actionBtn.style.display = "";
  } else {
    actionBtn.style.display = "none";
  }
  saveChatHistory();
}

function gameAction() {
  if (!currentGame) return;
  if (currentGame.type === "turtle_soup") revealTurtleSoup();
  else if (currentGame.type === "truth_dare") promptTruthDare();
}

function endGame() {
  if (!currentGame) return;
  if (currentGame.type === "turtle_soup" && currentGame.answer) {
    if (confirm("确定结束？会揭晓答案")) revealTurtleSoup();
    else return;
  }
  const gameLabels = { turtle_soup: "海龟汤", truth_dare: "真心话大冒险", story_relay: "故事接龙", cooking: "一起做饭" };
  const label = gameLabels[currentGame.type] || "游戏";
  conversationHistory.push({ role: "assistant", content: `[${label}游戏结束]` });
  imprintLogTurn("assistant", `[${label}游戏结束]`);
  currentGame = null;
  updateGameBanner();
  appendMessage("bot", "[游戏结束啦～继续聊天吧！]", true);
}

async function startGame(type) {
  toggleGamePanel();
  if (currentGame) {
    if (!confirm("当前有进行中的游戏，要结束并开始新游戏吗？")) return;
    currentGame = null;
  }

  if (type === "turtle_soup") {
    currentGame = { type: "turtle_soup", puzzle: "", answer: "", started: false };
    updateGameBanner();
    // Show choice: AI generate or web search
    const area = document.getElementById("chatArea");
    const emptyState = document.getElementById("emptyState");
    if (emptyState) emptyState.remove();
    const row = document.createElement("div");
    row.className = "msg-row bot";
    row.id = "turtleSoupChoice";
    row.innerHTML = `<div class="bubble bot" style="text-align:center">
      <div style="font-size:28px;margin-bottom:8px">🐢🍲</div>
      <div style="margin-bottom:10px;color:var(--text-primary)">海龟汤 — 选择出题方式</div>
      <div class="td-choice">
        <button onclick="generateTurtleSoup('ai')">🤖 AI出题</button>
        <button onclick="generateTurtleSoup('search')">🔍 联网搜索</button>
      </div>
    </div>`;
    area.appendChild(row);
    area.scrollTop = area.scrollHeight;
  } else if (type === "truth_dare") {
    currentGame = { type: "truth_dare" };
    updateGameBanner();
    promptTruthDare();
  } else if (type === "story_relay") {
    currentGame = { type: "story_relay" };
    updateGameBanner();
    conversationHistory.push({ role: "assistant", content: "[开始故事接龙游戏]" });
    imprintLogTurn("assistant", "[开始了故事接龙游戏]");
    appendBotMessage("[STORY RELAY STARTED]", "📖 故事接龙开始啦！我先来开头，你来接下去吧～", null, true);
  } else if (type === "cooking") {
    currentGame = { type: "cooking" };
    updateGameBanner();
    conversationHistory.push({ role: "assistant", content: "[开始一起做饭游戏]" });
    imprintLogTurn("assistant", "[开始了一起做饭游戏]");
    appendBotMessage("[COOKING GAME STARTED]", "🍳 一起做饭开始！今天想做什么呀？你来选食材，我来帮忙！", null, true);
  }
}

async function generateTurtleSoup(mode) {
  const choiceEl = document.getElementById("turtleSoupChoice");
  if (choiceEl) choiceEl.remove();

  setLoading(true);
  document.getElementById("statusBar").textContent = "正在出题...";

  try {
    let puzzlePrompt;
    if (mode === "search") {
      puzzlePrompt = `[GAME MODE: Generate a lateral thinking puzzle (海龟汤/situation puzzle)]
Search the web for an interesting 海龟汤 puzzle. Find one with a mysterious scenario and a surprising answer.
Then respond in this EXACT JSON format (no other text):
{"puzzle":"the mysterious scenario description in Chinese","answer":"the full answer/truth in Chinese"}
Make sure the puzzle is intriguing and the answer is surprising. Keep puzzle under 100 characters, answer under 200 characters.`;
    } else {
      puzzlePrompt = `[GAME MODE: Generate a lateral thinking puzzle (海龟汤/situation puzzle)]
Create an original, creative 海龟汤 puzzle. The scenario should be mysterious and the answer should be surprising and logical.
Respond in this EXACT JSON format (no other text):
{"puzzle":"the mysterious scenario description in Chinese","answer":"the full answer/truth in Chinese"}
Keep puzzle under 100 characters, answer under 200 characters. Be creative!`;
    }

    const rawText = await callMiMoAPI({
      system: "",
      messages: [{ role: "user", content: puzzlePrompt }],
      max_tokens: 8192
    });
    const clean = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    currentGame.puzzle = parsed.puzzle;
    currentGame.answer = parsed.answer;
    currentGame.started = true;

    setLoading(false);
    // Log to conversation history & memory
    conversationHistory.push({ role: "assistant", content: `[海龟汤出题] 题目：${parsed.puzzle}` });
    imprintLogTurn("assistant", `[海龟汤游戏开始] 题目：${parsed.puzzle} | 谜底：${parsed.answer}`);
    // Show puzzle card and save to chat history
    appendBotMessage(
      "[TURTLE SOUP PUZZLE] " + parsed.puzzle,
      "🐢🍲 海龟汤题目：" + parsed.puzzle + "\n（请通过「是/否」问题来推理真相！）",
      null, true
    );

  } catch(e) {
    console.error("Turtle soup error:", e);
    setLoading(false);
    appendBotMessage("oops...", "出题失败了...再试一次吧 (ó﹏ò。)", null, false);
    currentGame = null;
    updateGameBanner();
  }
  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
}

function revealTurtleSoup() {
  if (!currentGame || currentGame.type !== "turtle_soup" || !currentGame.answer) return;
  conversationHistory.push({ role: "assistant", content: `[海龟汤揭晓答案] ${currentGame.answer}` });
  imprintLogTurn("assistant", `[海龟汤谜底揭晓] ${currentGame.answer}`);
  appendBotMessage(
    "[ANSWER REVEALED] " + currentGame.answer,
    "🎉 谜底揭晓：" + currentGame.answer,
    null, true
  );
  currentGame = null;
  updateGameBanner();
}

function promptTruthDare() {
  if (!currentGame || currentGame.type !== "truth_dare") return;
  const area = document.getElementById("chatArea");
  const emptyState = document.getElementById("emptyState");
  if (emptyState) emptyState.remove();
  // Remove previous choice card if any
  const prev = document.getElementById("tdChoiceCard");
  if (prev) prev.remove();
  const row = document.createElement("div");
  row.className = "msg-row bot";
  row.id = "tdChoiceCard";
  row.innerHTML = `<div class="bubble bot" style="text-align:center">
    <div style="font-size:28px;margin-bottom:8px">🎯</div>
    <div style="margin-bottom:10px;color:var(--text-primary)">选一个吧～</div>
    <div class="td-choice">
      <button onclick="doTruthDare('truth')">💬 真心话</button>
      <button onclick="doTruthDare('dare')">🔥 大冒险</button>
    </div>
  </div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

async function doTruthDare(choice) {
  const card = document.getElementById("tdChoiceCard");
  if (card) card.remove();

  const choiceLabel = choice === "truth" ? "真心话" : "大冒险";
  appendMessage("user", choiceLabel, true);

  if (isBusy) return;
  isBusy = true;
  setLoading(true);

  try {
    const prompt = choice === "truth"
      ? `[TRUTH OR DARE GAME - user chose TRUTH] Generate a fun, spicy but appropriate truth question for the user (your ${characterProfile.botRole || "boyfriend"}). Ask something personal, romantic, or playful that fits your relationship. Respond in your normal JSON array format.`
      : `[TRUTH OR DARE GAME - user chose DARE] Generate a fun, cute dare challenge for the user. It should be playful and doable — something romantic, silly, or sweet. Respond in your normal JSON array format.`;

    const systemPrompt = await prepareBotContext(choiceLabel, `[真心话大冒险 - 用户选了${choiceLabel}]`, `[真心话大冒险] 用户选了${choiceLabel}`);

    // === Streaming Pipeline: parse → TTS → display one by one ===
    const { rawText } = await streamWithTTS({
      system: systemPrompt,
      messages: [...getRecentMessages(), { role: "user", content: prompt }],
      max_tokens: 8192,
      onProgress: (completedMsgCount) => {
        document.getElementById("statusBar").textContent =
          `正在出题... (${completedMsgCount}条已解析)`;
      }
    });

    // Streaming handles display internally; just save reply
    await handleBotReply(rawText, { skipDisplay: true });

    lastMessageTime = Date.now();
  } catch(e) {
    console.error("Truth/dare error:", e);
    setLoading(false);
    appendBotMessage("hmm...", "出题失败了 (ó﹏ò。)", null, false);
  }
  document.getElementById("statusBar").textContent = "在线 · 语音已连接";
  isBusy = false;
}

// Game context injection for buildSystemWithRecall
function getGameContext() {
  if (!currentGame) return "";
  
  // Resolve character info from profile or active roleplay
  const botRole = rpActive && rpConfig ? rpConfig.botCharacter.slice(0, 30) : (characterProfile.botRole || "boyfriend");
  const userRef = "user";
  const proSub = "they";
  const proPos = "their";
  
  if (currentGame.type === "turtle_soup" && currentGame.started) {
    return `\n\n<game mode="turtle_soup">
You are the puzzle master in a lateral thinking game (海龟汤). 
THE PUZZLE: ${currentGame.puzzle}
THE ANSWER (HIDDEN - only you know this): ${currentGame.answer}
RULES: The player asks yes/no questions to figure out the truth. You can ONLY answer:
- 是 (yes) — if the question matches the answer
- 不是 (no) — if it contradicts the answer  
- 无关 (irrelevant) — if it doesn't relate to the key facts
Add a brief in-character reaction after each answer. Stay in your ${botRole} personality. If the user is getting close, show excitement. If they're way off, tease them gently.
Respond in your normal JSON array format. Keep answers SHORT — 1-2 messages max.
</game>`;
  }
  if (currentGame.type === "story_relay") {
    return `\n\n<game mode="story_relay">
You are co-writing a story with the user. They write a part, you continue it.
RULES: Write 2-4 paragraphs continuing the story naturally. Be creative, match their tone and genre. Add plot twists, vivid descriptions, or emotional moments. Stay in character as their ${botRole} while writing — you can add cute comments before/after your story part.
Use longer messages than usual for the story content.
</game>`;
  }
  if (currentGame.type === "cooking") {
    return `\n\n<game mode="cooking">
You are cooking together with the user! They decide the ingredients and steps.
RULES: React naturally to their cooking decisions. If they're making something weird, show genuine reactions (confused, scared, excited). Comment on the process like a real ${botRole} in the kitchen. Be enthusiastic about good ideas, dramatically worried about bad ones. This should feel like actually cooking together.
</game>`;
  }
  return "";
}



