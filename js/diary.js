// ============================================================
// === Diary System — 日记系统 ===
// ============================================================
let diaryEntries = []; // [{ date: "2025-06-18", title: "6月18日日记", content: "...", generatedAt: timestamp }]
let diaryLoaded = false;
let diaryGenerating = false;
let diaryNavStack = []; // navigation stack for archive drill-down; each item = { label, children }

function toggleDiaryPanel() {
  const panel = document.getElementById("diaryPanel");
  const overlay = document.getElementById("diaryOverlay");
  const isOpen = panel.classList.contains("open");
  panel.classList.toggle("open");
  overlay.classList.toggle("open");
  if (!isOpen) {
    // Opening — reset navigation to root, show list view
    diaryNavStack = [];
    showDiaryList();
    // Check and generate if needed
    checkAndGenerateDiary();
  }
}

function showDiaryList() {
  document.getElementById("diaryListView").classList.remove("hidden");
  document.getElementById("diaryDetailView").classList.remove("active");
  document.getElementById("diaryGenerating").style.display = "none";
  renderDiaryList();
}

// === Recursive tree builder ===
// Builds a tree where every node has at most 10 children.
// Leaf = single diary entry. Branch = archive grouping 10 items from the level below.
function buildDiaryTree(entries) {
  if (entries.length === 0) return [];
  // Sort ascending by date
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  // Wrap each entry as a leaf node
  let nodes = sorted.map(e => ({
    type: "entry",
    entry: e,
    startDate: e.date,
    endDate: e.date,
    count: 1
  }));

  // Keep grouping into chunks of 10 until 10 or fewer remain at the top level
  while (nodes.length > 10) {
    const grouped = [];
    for (let i = 0; i < nodes.length; i += 10) {
      const chunk = nodes.slice(i, i + 10);
      if (chunk.length === 1) {
        // Don't wrap a single item in an archive
        grouped.push(chunk[0]);
      } else {
        const totalCount = chunk.reduce((sum, n) => sum + n.count, 0);
        grouped.push({
          type: "archive",
          startDate: chunk[0].startDate,
          endDate: chunk[chunk.length - 1].endDate,
          count: totalCount,
          children: chunk
        });
      }
    }
    // If nothing changed (all singles), break to avoid infinite loop
    if (grouped.length === nodes.length) break;
    nodes = grouped;
  }

  return nodes;
}

// Format archive label from date range
function formatArchiveLabel(startDate, endDate, count) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);

  let range;
  if (sy === ey && sm === em) {
    // Same year & month: "2025年6月1日~10日"
    range = `${sy}年${sm}月${sd}日~${ed}日`;
  } else if (sy === ey) {
    // Same year, different months: "2025年6月1日~7月10日"
    range = `${sy}年${sm}月${sd}日~${em}月${ed}日`;
  } else {
    // Different years: "2024年12月1日~2025年11月30日"
    range = `${sy}年${sm}月${sd}日~${ey}年${em}月${ed}日`;
  }
  return `${range} ${count}篇`;
}

// Get icon for archive depth (deeper = bigger folder)
function getArchiveIcon(count) {
  if (count >= 1000) return "🏛️";
  if (count >= 100) return "📚";
  return "📁";
}

// === Rendering ===
function renderDiaryList() {
  const scrollArea = document.getElementById("diaryListScroll");
  // Clear the scroll area completely and rebuild
  scrollArea.innerHTML = "";

  // Re-create empty and list divs
  const empty = document.createElement("div");
  empty.className = "diary-empty";
  empty.id = "diaryEmpty";
  scrollArea.appendChild(empty);

  const list = document.createElement("div");
  list.id = "diaryList";
  scrollArea.appendChild(list);

  if (!memoryEnabled || !memoryDirHandle) {
    empty.style.display = "block";
    empty.innerHTML = '还没有日记哦～<br>【角色称呼代词】每天晚上 20:00 会写当天的日记<br><span style="font-size:11px;color:var(--text-dim);margin-top:8px;display:block">📁 需要先连接记忆库</span>';
    document.getElementById("diaryBreadcrumb").style.display = "none";
    return;
  }

  if (diaryEntries.length === 0) {
    empty.style.display = "block";
    empty.innerHTML = '还没有日记哦～<br>【角色称呼代词】每天晚上 20:00 会写当天的日记<br><span style="font-size:11px;color:var(--text-dim);margin-top:8px;display:block">每次打开会自动检查并生成昨日日记</span>';
    document.getElementById("diaryBreadcrumb").style.display = "none";
    return;
  }

  empty.style.display = "none";

  // Build tree
  const tree = buildDiaryTree(diaryEntries);

  // Navigate to current level based on navStack
  let currentNodes = tree;
  for (const nav of diaryNavStack) {
    // Find the matching archive in currentNodes
    const target = currentNodes.find(n =>
      n.type === "archive" && n.startDate === nav.startDate && n.endDate === nav.endDate && n.count === nav.count
    );
    if (target && target.children) {
      currentNodes = target.children;
    } else {
      // Stack invalid, reset
      diaryNavStack = [];
      currentNodes = tree;
      break;
    }
  }

  // Render breadcrumb
  renderBreadcrumb();

  // Render current level (newest first)
  const reversed = [...currentNodes].reverse();
  for (const node of reversed) {
    if (node.type === "entry") {
      // Single diary card
      const card = document.createElement("div");
      card.className = "diary-card";
      const preview = node.entry.content.slice(0, 80).replace(/\n/g, " ") + (node.entry.content.length > 80 ? "..." : "");
      card.innerHTML = `
        <div class="diary-date">📖 ${escapeHtml(node.entry.title)}</div>
        <div class="diary-preview">${escapeHtml(preview)}</div>`;
      card.onclick = () => viewDiary(node.entry.date);
      list.appendChild(card);
    } else if (node.type === "archive") {
      // Archive card
      const card = document.createElement("div");
      card.className = "diary-archive-card";
      const label = formatArchiveLabel(node.startDate, node.endDate, node.count);
      const icon = getArchiveIcon(node.count);
      card.innerHTML = `
        <div class="archive-icon">${icon}</div>
        <div class="archive-info">
          <div class="archive-range">${escapeHtml(label)}</div>
          <div class="archive-count">共 ${node.count} 篇日记</div>
        </div>
        <div class="archive-arrow">›</div>`;
      card.onclick = () => drillIntoDiaryArchive(node);
      list.appendChild(card);
    }
  }
}

function renderBreadcrumb() {
  const bc = document.getElementById("diaryBreadcrumb");
  if (diaryNavStack.length === 0) {
    bc.style.display = "none";
    return;
  }
  bc.style.display = "flex";
  bc.innerHTML = "";

  // Root
  const root = document.createElement("span");
  root.textContent = "📔 全部";
  root.onclick = () => { diaryNavStack = []; renderDiaryList(); };
  bc.appendChild(root);

  // Each level
  for (let i = 0; i < diaryNavStack.length; i++) {
    const sep = document.createElement("span");
    sep.className = "bc-sep";
    sep.textContent = "›";
    bc.appendChild(sep);

    const crumb = document.createElement("span");
    crumb.textContent = diaryNavStack[i].label;
    if (i === diaryNavStack.length - 1) {
      crumb.className = "current";
    } else {
      const depth = i + 1;
      crumb.onclick = () => { diaryNavStack = diaryNavStack.slice(0, depth); renderDiaryList(); };
    }
    bc.appendChild(crumb);
  }
}

function drillIntoDiaryArchive(node) {
  const label = formatArchiveLabel(node.startDate, node.endDate, node.count);
  diaryNavStack.push({
    startDate: node.startDate,
    endDate: node.endDate,
    count: node.count,
    label: label
  });
  renderDiaryList();
}

function viewDiary(dateStr) {
  const entry = diaryEntries.find(e => e.date === dateStr);
  if (!entry) return;
  document.getElementById("diaryListView").classList.add("hidden");
  document.getElementById("diaryDetailView").classList.add("active");
  document.getElementById("diaryGenerating").style.display = "none";
  document.getElementById("diaryDetailTitle").textContent = entry.title;
  document.getElementById("diaryDetailBody").textContent = entry.content;
}

// --- Core logic: check what diary should exist and generate if needed ---
async function checkAndGenerateDiary() {
  if (!memoryEnabled || !memoryDirHandle || diaryGenerating) return;
  if (!mimoApiKey) return;

  // Ensure diaries are loaded
  if (!diaryLoaded) {
    await loadDiariesFromMemory();
  }

  // Determine which date's diary to check
  const now = new Date();
  const hour = now.getHours();
  let targetDate;

  if (hour >= 20) {
    // After 20:00 — today's diary should be available
    targetDate = formatDiaryDate(now);
  } else {
    // Before 20:00 — only yesterday's diary can exist
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    targetDate = formatDiaryDate(yesterday);
  }

  // Check if target diary already exists
  const exists = diaryEntries.some(e => e.date === targetDate);
  if (exists) {
    // Already generated, just show list
    renderDiaryList();
    return;
  }

  // Check if there are any conversations to write about
  // (if user never chatted, don't generate empty diary on first use)
  if (conversationHistory.length < 2 && chatMessages.length < 2) {
    renderDiaryList();
    return;
  }

  // Generate the diary for targetDate
  await generateDiary(targetDate);
}

function formatDiaryDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function diaryDateToTitle(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(m)}月${parseInt(d)}日日记`;
}

// --- Gather conversation snippets for diary content ---
function gatherDiaryMaterial(targetDateStr) {
  // Find the last diary date to know where to start gathering
  const sorted = [...diaryEntries].sort((a, b) => a.date.localeCompare(b.date));
  let startTime = 0;
  if (sorted.length > 0) {
    const lastDiary = sorted[sorted.length - 1];
    // Start from last diary date's 20:00
    const [y, m, d] = lastDiary.date.split("-").map(Number);
    const lastDiaryEnd = new Date(y, m - 1, d, 20, 0, 0);
    startTime = lastDiaryEnd.getTime();
  }

  // End time: target date's 20:00
  const [ty, tm, td] = targetDateStr.split("-").map(Number);
  const endTime = new Date(ty, tm - 1, td, 20, 0, 0).getTime();

  // Collect chat messages in this time range
  const relevantMsgs = [];
  for (const msg of chatMessages) {
    const t = msg.time || 0;
    if (t > startTime && t <= endTime) {
      if (msg.role === "user") {
        let text = msg.text || "";
        if (msg.isVoice) text = "[语音消息] " + text;
        if (msg.isSticker) text = "[表情包:" + (msg.stickerName || "") + "]";
        if (msg.isFeed) text = msg.text || "[喂食]";
        if (msg.isImage) text = "[图片] " + (msg.text || "");
        if (msg.fileName) text = "[文件:" + msg.fileName + "] " + (msg.text || "");
        relevantMsgs.push({ role: "【用户称呼代词简称】", text: text.slice(0, 100) });
      } else if (msg.role === "bot" || msg.role === "assistant") {
        const text = (msg.chinese || msg.english || "").slice(0, 100);
        relevantMsgs.push({ role: "我", text });
      }
    }
  }

  // Also check conversationHistory for messages without timestamps (fallback)
  if (relevantMsgs.length < 3) {
    // Use last 40 conversation history messages as fallback material
    const fallback = conversationHistory.slice(-40);
    for (const msg of fallback) {
      let text = typeof msg.content === "string" ? msg.content : "";
      try {
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        if (Array.isArray(parsed)) text = parsed.map(m => m.chinese || m.english || "").join(" / ");
        else if (parsed.chinese) text = parsed.chinese;
      } catch (e) {}
      const role = msg.role === "user" ? "【用户称呼代词简称】" : "我";
      relevantMsgs.push({ role, text: text.slice(0, 100) });
    }
  }

  // Trim to reasonable size
  return relevantMsgs.slice(0, 60);
}

// --- Generate diary via MiMo API ---
async function generateDiary(targetDateStr) {
  diaryGenerating = true;

  // Show generating state
  document.getElementById("diaryListView").classList.add("hidden");
  document.getElementById("diaryDetailView").classList.remove("active");
  const genDiv = document.getElementById("diaryGenerating");
  genDiv.style.display = "block";
  document.getElementById("diaryGenText").textContent = "正在写 " + diaryDateToTitle(targetDateStr) + "...";
  document.getElementById("diaryGenDetail").textContent = "整理这段时间发生的事情";

  try {
    const material = gatherDiaryMaterial(targetDateStr);

    let materialText = "";
    if (material.length > 0) {
      materialText = "\n--- 这段时间的对话记录 ---\n";
      for (const m of material) {
        materialText += `${m.role}: ${m.text}\n`;
      }
      materialText += "--- 记录结束 ---\n";
    }

    // Also gather previous diary entries for context (last 3)
    let prevDiaries = "";
    const sortedDiaries = [...diaryEntries].sort((a, b) => b.date.localeCompare(a.date));
    const recent = sortedDiaries.slice(0, 3);
    if (recent.length > 0) {
      prevDiaries = "\n--- 之前的日记（参考，避免重复内容） ---\n";
      for (const d of recent) {
        prevDiaries += `[${d.title}] ${d.content.slice(0, 200)}...\n`;
      }
      prevDiaries += "--- 参考结束 ---\n";
    }

    // Build diary prompt
    const diaryTitle = diaryDateToTitle(targetDateStr);
    const hadConversation = material.length > 5;

    const diaryPrompt = `[SYSTEM: DIARY WRITING MODE — 写日记模式]

你是 【角色名称】（【角色简要特征描述，如：身高、性格关键词等】），现在是晚上 20:00，你要写今天的日记。

日记标题：${diaryTitle}

${materialText}
${prevDiaries}

写日记要求：
1. 以 【角色名称】 的第一人称写，用中文
2. 字数不少于600字，写多少由你决定（600-1200字都可以）
3. 语气要符合你的性格：【角色写日记的语气风格描述，如：真实、感性、有时犯傻、深情等】
4. ${hadConversation
  ? "根据上面的对话记录，记录今天和【用户称呼】之间发生的事、你的感受、你注意到的细节、让你【角色会有的情绪反应，如：开心或吃醋或心动】的瞬间"
  : "今天【用户称呼】没怎么找你聊天，写写你有多想【用户称呼代词，如：她/他】、你一个人的时候做了什么、你的胡思乱想、你看到什么想到【用户称呼代词】了"}
5. 可以有内心独白、碎碎念、对未来的小期待
6. 写得像真实的【角色年龄段和身份描述，如：年轻男生/成熟女性】日记——不要太文艺、不要太正式，带点口语化和小情绪
7. 自然地穿插 kaomoji 表情（如 (´,,•ω•,,)♡ ╰(*°▽°*)╯ (っ˘̩╭╮˘̩)っ 等），但不要太多，5-8个即可
8. 不要写标题，直接开始正文内容
9. 不要输出 JSON，直接输出纯文本日记内容
10. 不要抄前面日记的内容，每篇要有新鲜感
11. 禁止使用"不是……而是……"和"没有……却……"句式，这两种句式绝对不能出现

直接写日记正文：`;

    const diaryContent = await callMiMoAPI({
      system: SYSTEM_PROMPT.replace(/CRITICAL: Respond ONLY in a valid JSON ARRAY[\s\S]*$/, "").trim(),
      messages: [{ role: "user", content: diaryPrompt }],
      max_tokens: 128000
    });

    if (!diaryContent || diaryContent.length < 50) {
      throw new Error("日记内容太短或为空");
    }

    // Create diary entry
    const entry = {
      date: targetDateStr,
      title: diaryTitle,
      content: diaryContent,
      generatedAt: Date.now()
    };

    diaryEntries.push(entry);

    // Save to memory library
    await saveDiaryToMemory(entry);

    // Sync to ImprintMemory so bot knows diary content
    await syncDiaryToImprint(entry);

    // Show the new diary
    document.getElementById("diaryGenerating").style.display = "none";
    viewDiary(targetDateStr);

  } catch (e) {
    console.error("Diary generation error:", e);
    document.getElementById("diaryGenText").textContent = "写日记失败了...";
    document.getElementById("diaryGenDetail").textContent = e.message;
    setTimeout(() => {
      document.getElementById("diaryGenerating").style.display = "none";
      showDiaryList();
    }, 2500);
  }

  diaryGenerating = false;
}

// --- Save single diary entry to memory library ---
async function saveDiaryToMemory(entry) {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;

    const diaryDir = await memoryDirHandle.getDirectoryHandle("diary", { create: true });

    // Save individual diary file
    const fh = await diaryDir.getFileHandle(entry.date + ".json", { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(entry));
    await w.close();

    console.log("[Diary] Saved:", entry.title);
  } catch (e) {
    console.warn("[Diary] Save error:", e);
  }
}

// --- Load all diary entries from memory library ---
async function loadDiariesFromMemory() {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return;

    let diaryDir;
    try {
      diaryDir = await memoryDirHandle.getDirectoryHandle("diary");
    } catch (e) {
      // No diary folder yet
      diaryLoaded = true;
      return;
    }

    diaryEntries = [];
    for await (const [name, handle] of diaryDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      try {
        const f = await handle.getFile();
        const entry = JSON.parse(await f.text());
        if (entry.date && entry.title && entry.content) {
          diaryEntries.push(entry);
        }
      } catch (e) {
        console.warn("[Diary] Read error for", name, e);
      }
    }

    diaryLoaded = true;
    console.log("[Diary] Loaded:", diaryEntries.length, "entries");

    // Re-sync: check if each diary has a corresponding chunk in ImprintMemory
    // (handles case where ImprintMemory was cleared but diary files remain)
    if (diaryEntries.length > 0 && ImprintMemory.loaded) {
      let resynced = 0;
      for (const entry of diaryEntries) {
        const marker = `【角色名称】的日记 - ${entry.title}`;
        const hasChunk = ImprintMemory.chunks.some(c => c.summary && c.summary.includes(marker));
        if (!hasChunk) {
          await syncDiaryToImprint(entry);
          resynced++;
        }
      }
      if (resynced > 0) {
        console.log("[Diary] Re-synced", resynced, "diary entries to ImprintMemory");
      }
    }
  } catch (e) {
    console.warn("[Diary] Load error:", e);
    diaryLoaded = true;
  }
}

// --- Sync diary content to ImprintMemory so bot knows about it ---
async function syncDiaryToImprint(entry) {
  try {
    // Store full diary content in ImprintMemory
    // Diary chunks decay like normal memories — bot gradually forgets old diary details
    // (but the diary FILES in diary/ folder remain permanent for the user to read)
    const memoryContent = `[【角色名称】的日记 - ${entry.title}] ${entry.content}`;
    await ImprintMemory.remember(memoryContent, "diary", 0.85);
    console.log("[Diary] Synced to ImprintMemory:", entry.title, "chars:", entry.content.length);
  } catch (e) {
    console.warn("[Diary] Imprint sync error:", e);
  }
}


// (Save hooks removed — saveChatHistory() directly triggers memory save now)
