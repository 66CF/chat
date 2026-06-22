// === Memory Loading Overlay ===
function showMemoryLoader(text) {
  const el = document.getElementById("memoryLoadingOverlay");
  el.style.display = "flex";
  el.classList.remove("fade-out");
  document.getElementById("loaderText").textContent = text || "正在连接记忆库...";
  document.getElementById("loaderBar").style.width = "0%";
  document.getElementById("loaderDetail").textContent = "";
}
function updateMemoryLoader(percent, detail) {
  document.getElementById("loaderBar").style.width = Math.min(percent, 100) + "%";
  if (detail) document.getElementById("loaderDetail").textContent = detail;
}
function hideMemoryLoader() {
  document.getElementById("loaderBar").style.width = "100%";
  document.getElementById("loaderDetail").textContent = "加载完成 ✓";
  setTimeout(() => {
    document.getElementById("memoryLoadingOverlay").classList.add("fade-out");
    setTimeout(() => {
      document.getElementById("memoryLoadingOverlay").style.display = "none";
    }, 500);
  }, 400);
}


// ============================================================
// === Imprint Memory — 长期记忆系统 (inspired by imprint-memory) ===
// ============================================================
const ImprintMemory = {
  chunks: [],      // { id, summary, keywords, startTime, endTime, msgRange }
  vectors: [],     // { id, vec: Float64Array }
  meta: [],        // { id, importance, recallCount, lastRecall, pinned, tags, category }
  edges: [],       // { src, dst, relation }
  turnBuffer: [],  // un-chunked messages waiting to be summarized
  loaded: false,
  dirty: false,
  chunkSize: 12,   // messages per chunk
  _saveTimer: null,

  // --- Embedding via Google Gemini ---
  async embed(text) {
    if (!googleApiKey) return null;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${googleApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: safeStringify({
            content: { parts: [{ text: text.slice(0, 2000) }] },
            taskType: "RETRIEVAL_DOCUMENT"
          })
        }
      );
      if (!res.ok) { const errBody = await res.text().catch(()=>""); console.warn("Embed API error:", res.status, errBody.slice(0, 200)); return null; }
      const data = await res.json();
      return data?.embedding?.values || null;
    } catch (e) { console.warn("Embed error:", e); return null; }
  },

  async embedQuery(text) {
    if (!googleApiKey) return null;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${googleApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: safeStringify({
            content: { parts: [{ text: text.slice(0, 500) }] },
            taskType: "RETRIEVAL_QUERY"
          })
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data?.embedding?.values || null;
    } catch (e) { return null; }
  },

  // --- Cosine Similarity ---
  cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  },

  // --- Log a conversation turn ---
  logTurn(role, content) {
    this.turnBuffer.push({
      role,
      content: (typeof content === "string" ? content : safeStringify(content)).slice(0, 1000),
      time: Date.now()
    });
    this.dirty = true;
    // Auto-chunk when buffer reaches threshold
    if (this.turnBuffer.length >= this.chunkSize) {
      this.summarizeChunk();
    }
  },

  // --- Summarize buffered turns into a chunk ---
  async summarizeChunk() {
    if (this.turnBuffer.length < 4 || !mimoApiKey) return;

    const batch = this.turnBuffer.splice(0, this.chunkSize);
    const transcript = batch.map(t => {
      const role = t.role === "user" ? "【用户称呼代词简称，如：她/他】" : "【角色称呼代词简称，如：他/她】";
      const time = t.time ? formatMsgTime(t.time) : "";
      return `[${time}] ${role}: ${t.content.slice(0, 200)}`;
    }).join("\n");

    try {
      const raw = await callMiMoAPI({
        system: `你是记忆摘要助手。把对话片段压缩成一段简洁摘要（中文，50-100字）+关键词列表。
回复严格JSON格式，不要其他内容：
{"summary":"摘要内容","keywords":["关键词1","关键词2"],"category":"facts|events|insights","importance":0.5}
importance 范围 0-1，越重要越高。涉及个人偏好/生日/重要事件给0.8+，普通闲聊给0.3-0.5。`,
        messages: [{ role: "user", content: transcript }],
        max_tokens: 300
      });
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      const chunkId = "chunk_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      const chunk = {
        id: chunkId,
        summary: parsed.summary || transcript.slice(0, 100),
        keywords: parsed.keywords || [],
        startTime: batch[0].time,
        endTime: batch[batch.length - 1].time,
        rawMessages: batch
      };
      this.chunks.push(chunk);

      const metaEntry = {
        id: chunkId,
        importance: parsed.importance || 0.5,
        category: parsed.category || "events",
        recallCount: 0,
        lastRecall: 0,
        pinned: false,
        tags: parsed.keywords || []
      };
      this.meta.push(metaEntry);

      // Generate embedding async
      const vec = await this.embed(parsed.summary + " " + (parsed.keywords || []).join(" "));
      if (vec) {
        this.vectors.push({ id: chunkId, vec });
      }

      this.dirty = true;
      this.scheduleSave();
      console.log("[Imprint] Chunk created:", chunkId, parsed.summary?.slice(0, 40));
    } catch (e) {
      console.warn("[Imprint] Chunk summarize error:", e);
      this.turnBuffer.unshift(...batch);
    }
  },

  // --- Signal detection (should we search?) ---
  shouldSurface(text) {
    const signals = [
      /记得|之前|上次|那时|那次|以前|第一次|最近|当时|那天|那年|那会/,
      /想起来|想起|突然想到|说起|提到|有一次/,
      /累|难过|开心|想你|害怕|迷茫|烦|伤心|生气|焦虑|崩溃|委屈/,
      /你还记|我们的|那个时候|你说过|我说过|我们说|咱们/,
      /今天.{0,4}了|刚才|刚刚|昨天|前天|[\d一二两三四五六七八九十几]+[天周月年]前/,
      /remember|last\s+time|back\s+then|before|used\s+to|ago/i,
      /yesterday|last\s+(week|month|year|night)/i,
      /you\s+(said|told|promised|mentioned)/i,
      /do\s+you\s+remember|recall/i,
      /生日|周年|纪念|喜欢吃|不喜欢|过敏|爱好|习惯|最爱|最讨厌/,
    ];
    return signals.some(p => p.test(text));
  },

  // --- Keyword search ---
  keywordSearch(query, limit = 10) {
    const terms = this._tokenize(query);
    if (terms.length === 0) return [];

    const results = [];
    for (const chunk of this.chunks) {
      const text = (chunk.summary + " " + (chunk.keywords || []).join(" ")).toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score += 1;
        // Exact keyword match bonus
        if ((chunk.keywords || []).some(k => k.toLowerCase().includes(term))) score += 0.5;
      }
      if (score > 0) {
        results.push({ id: chunk.id, score: score / terms.length, chunk });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  // --- Vector search ---
  async vectorSearch(query, limit = 10) {
    const qVec = await this.embedQuery(query);
    if (!qVec || this.vectors.length === 0) return [];

    const results = [];
    for (const v of this.vectors) {
      const sim = this.cosineSim(qVec, v.vec);
      if (sim > 0.45) {
        const chunk = this.chunks.find(c => c.id === v.id);
        if (chunk) results.push({ id: v.id, score: sim, chunk });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  // --- RRF Fusion (Reciprocal Rank Fusion) ---
  rrfFuse(keywordResults, vectorResults, k = 60) {
    const scores = {};
    const chunkMap = {};

    const addScores = (results) => {
      results.forEach((r, rank) => {
        const rrf = 1 / (k + rank + 1);
        scores[r.id] = (scores[r.id] || 0) + rrf;
        chunkMap[r.id] = r.chunk;
      });
    };

    addScores(keywordResults);
    addScores(vectorResults);

    // Apply meta boosts
    for (const id of Object.keys(scores)) {
      const m = this.meta.find(x => x.id === id);
      if (m) {
        if (m.pinned) scores[id] *= 1.5;
        scores[id] *= (0.7 + m.importance * 0.6);
        // Recency boost (within last 7 days)
        const chunk = chunkMap[id];
        if (chunk && (Date.now() - chunk.endTime) < 7 * 86400000) {
          scores[id] *= 1.2;
        }
      }
    }

    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, score]) => ({ id, score, chunk: chunkMap[id] }));
  },

  // --- Unified search ---
  async search(query, limit = 6) {
    const kwResults = this.keywordSearch(query, 15);
    const vecResults = await this.vectorSearch(query, 15);
    const fused = this.rrfFuse(kwResults, vecResults);

    // Update recall counts
    for (const r of fused) {
      const m = this.meta.find(x => x.id === r.id);
      if (m) { m.recallCount++; m.lastRecall = Date.now(); }
    }
    if (fused.length > 0) this.dirty = true;

    return fused.slice(0, limit);
  },

  // --- Step 2: Raw conversation search (fallback when chunks miss details) ---
  searchRawHistory(query, limit = 5) {
    const terms = this._tokenize(query);
    if (terms.length === 0 || !conversationHistory) return [];

    const results = [];
    // Skip the last 2 messages to avoid matching the current turn against itself
    const searchEnd = Math.max(0, conversationHistory.length - 2);
    for (let i = 0; i < searchEnd; i++) {
      const msg = conversationHistory[i];
      let text = typeof msg.content === "string" ? msg.content : "";
      // Try to extract Chinese from JSON bot responses
      try {
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        if (Array.isArray(parsed)) text = parsed.map(m => m.chinese || m.english || "").join(" ");
        else if (parsed.chinese) text = parsed.chinese;
      } catch(e) {}

      const lower = text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (lower.includes(term)) score += 1;
      }
      if (score > 0) {
        // Also grab the neighboring message for context (user→bot or bot→user pair)
        const neighbor = conversationHistory[i + 1];
        let neighborText = "";
        if (neighbor && typeof neighbor.content === "string") {
          try {
            const p = JSON.parse(neighbor.content.replace(/```json|```/g, "").trim());
            if (Array.isArray(p)) neighborText = p.map(m => m.chinese || m.english || "").join(" ");
            else if (p.chinese) neighborText = p.chinese;
            else neighborText = neighbor.content;
          } catch(e) { neighborText = neighbor.content; }
        }

        const role = msg.role === "user" ? "【用户称呼代词简称】" : "【角色称呼代词简称】";
        const neighborRole = neighbor?.role === "user" ? "【用户称呼代词简称】" : "【角色称呼代词简称】";
        let display = `${role}: ${text.slice(0, 150)}`;
        if (neighborText) display += ` → ${neighborRole}: ${neighborText.slice(0, 150)}`;

        results.push({ score: score / terms.length, text: display, index: i });
      }
    }

    // Deduplicate (don't show overlapping pairs)
    const seen = new Set();
    return results
      .sort((a, b) => b.score - a.score)
      .filter(r => {
        if (seen.has(r.index) || seen.has(r.index + 1)) return false;
        seen.add(r.index);
        seen.add(r.index + 1);
        return true;
      })
      .slice(0, limit);
  },

  // --- Surfacing search: two-step (chunks → raw fallback) ---
  async surfacingSearch(userMsg) {
    if (this.chunks.length === 0 && (!conversationHistory || conversationHistory.length < 10)) return "";
    if (!this.shouldSurface(userMsg) && this.chunks.length < 5) return "";

    const lines = [];

    // Step 1: Search chunks (summaries + vectors)
    if (this.chunks.length > 0) {
      const results = await this.search(userMsg, 6);
      for (const r of results) {
        const date = new Date(r.chunk.endTime).toLocaleDateString("zh-CN");
        lines.push(`[${date}] ${r.chunk.summary}`);
      }
    }

    // Step 2: Raw conversation fallback (catches details summaries missed)
    // Only search messages outside the recent context window (last 20 msgs)
    const rawResults = this.searchRawHistory(userMsg, 3);
    if (rawResults.length > 0) {
      const contextCutoff = Math.max(0, conversationHistory.length - 20);
      // Only add raw results that aren't redundant with chunk results
      // and aren't within the recent context window MiMo already sees
      const rawLines = rawResults
        .filter(r => r.index < contextCutoff)
        .map(r => `[原文] ${r.text}`);
      lines.push(...rawLines);
    }

    // Trim to max 8 lines to avoid bloating the prompt
    return lines.slice(0, 8).join("\n");
  },

  // --- Manual remember (AI-flagged highlight) ---
  async remember(content, category = "facts", importance = 0.8) {
    const chunkId = "mem_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const chunk = {
      id: chunkId,
      summary: content,
      keywords: this._tokenize(content),
      startTime: Date.now(),
      endTime: Date.now(),
      rawMessages: []
    };
    this.chunks.push(chunk);
    this.meta.push({
      id: chunkId, importance, category,
      recallCount: 0, lastRecall: 0, pinned: importance >= 0.9,
      tags: this._tokenize(content)
    });

    const vec = await this.embed(content);
    if (vec) this.vectors.push({ id: chunkId, vec });

    this.dirty = true;
    this.scheduleSave();
  },

  // --- Memory decay ---
  decay(dryRun = true) {
    const now = Date.now();
    const stale = this.meta.filter(m => {
      if (m.pinned) return false;
      const age = (now - m.lastRecall) / 86400000; // days
      return age > 30 && m.importance > 0.1;
    });

    if (!dryRun) {
      for (const m of stale) {
        m.importance = Math.max(0.1, m.importance * 0.8);
      }
      this.dirty = true;
    }
    return stale;
  },

  // --- Tokenize (simple CJK + word tokenizer) ---
  _tokenize(text) {
    const stops = new Set(["的","了","在","是","我","你","他","她","它","们","和","与",
      "对","这","那","有","也","就","都","而","及","或","但","如","把","被","让",
      "a","the","is","are","was","were","to","of","and","in","on","at","for","with"]);
    const t = (text || "").toLowerCase();
    // Split on non-letter/non-CJK boundaries
    const tokens = t.match(/[\u4e00-\u9fff\u3400-\u4dbf]{1,4}|[a-z0-9]{2,}/g) || [];
    return [...new Set(tokens.filter(w => !stops.has(w) && w.length > 1))];
  },

  // --- Save to memory library folder ---
  async save(dirHandle) {
    if (!dirHandle || !this.dirty) return;
    try {
      const perm = await dirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") return;

      const memDir = await dirHandle.getDirectoryHandle("memory", { create: true });

      // Save chunks
      const cf = await memDir.getFileHandle("chunks.json", { create: true });
      const cw = await cf.createWritable();
      await cw.write(JSON.stringify(this.chunks));
      await cw.close();

      // Save vectors (convert to plain arrays for JSON)
      const vf = await memDir.getFileHandle("vectors.json", { create: true });
      const vw = await vf.createWritable();
      await vw.write(JSON.stringify(this.vectors.map(v => ({ id: v.id, vec: Array.from(v.vec) }))));
      await vw.close();

      // Save meta
      const mf = await memDir.getFileHandle("meta.json", { create: true });
      const mw = await mf.createWritable();
      await mw.write(JSON.stringify(this.meta));
      await mw.close();

      // Save edges
      const ef = await memDir.getFileHandle("edges.json", { create: true });
      const ew = await ef.createWritable();
      await ew.write(JSON.stringify(this.edges));
      await ew.close();

      // Save turn buffer
      const tf = await memDir.getFileHandle("buffer.json", { create: true });
      const tw = await tf.createWritable();
      await tw.write(JSON.stringify(this.turnBuffer));
      await tw.close();

      this.dirty = false;
      console.log("[Imprint] Memory saved:", this.chunks.length, "chunks,", this.vectors.length, "vectors");
    } catch (e) { console.warn("[Imprint] Save error:", e); }
  },

  // --- Load from memory library folder ---
  async load(dirHandle) {
    if (!dirHandle) return;
    try {
      const perm = await dirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") return;

      let memDir;
      try { memDir = await dirHandle.getDirectoryHandle("memory"); }
      catch (e) { this.loaded = true; return; } // No memory folder yet

      const readJSON = async (name) => {
        try {
          const fh = await memDir.getFileHandle(name);
          const f = await fh.getFile();
          return JSON.parse(await f.text());
        } catch (e) { console.warn("[Imprint] Read", name, "error:", e.message); return null; }
      };

      const chunks = await readJSON("chunks.json");
      if (chunks) this.chunks = chunks;

      const vectors = await readJSON("vectors.json");
      if (vectors) this.vectors = vectors;

      const meta = await readJSON("meta.json");
      if (meta) this.meta = meta;

      const edges = await readJSON("edges.json");
      if (edges) this.edges = edges;

      const buffer = await readJSON("buffer.json");
      if (buffer) this.turnBuffer = buffer;

      this.loaded = true;
      console.log("[Imprint] Memory loaded:", this.chunks.length, "chunks,", this.vectors.length, "vectors");
    } catch (e) { console.warn("[Imprint] Load error:", e); this.loaded = true; }
  },

  scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      if (memoryDirHandle && memoryEnabled) this.save(memoryDirHandle);
    }, 3000);
  }
};

// --- Helper: build system prompt with recall injection ---
async function buildSystemWithRecall(userText) {
  // Time awareness
  const now = new Date();
  const weekdays = ["日","一","二","三","四","五","六"];
  const timeStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const hour = now.getHours();
  const period = hour < 6 ? "凌晨" : hour < 9 ? "早上" : hour < 12 ? "上午" : hour < 14 ? "中午" : hour < 18 ? "下午" : hour < 22 ? "晚上" : "深夜";
  const timeBlock = `\n\n<current-time>
【重要】现在的真实时间是 ${timeStr}（${period}）。
你必须准确知道现在几点。绝对不要说错时间或自己编造时间。如果你要提到时间，必须和上面一致。
根据时段自然反应：凌晨/深夜→关心【用户称呼代词】怎么还没睡、早上→早安、中午/傍晚→吃饭了吗、晚上→陪【用户称呼代词】放松。
不需要每条消息都提时间，但一旦提到就必须是正确的。
</current-time>`;

  // Sticker catalog
  let stickerBlock = "";
  if (stickerCatalog.length > 0) {
    const names = stickerCatalog.map(s => s.name).join("、");
    stickerBlock = `\n\n<stickers>
可用表情包：${names}
名字=画面内容，根据情境选最合适的。发送方式：在消息加"sticker"字段，值必须完全匹配列表名称。
例：{"english":"hehe~","chinese":"嘿嘿~","sticker":"得意"}
省着用！平均每10-15条消息发一次，情绪强烈时才发。
</stickers>`;
  }

  let recallBlock = "";
  try {
    if (ImprintMemory.chunks.length > 0) {
      const recalled = await ImprintMemory.surfacingSearch(userText);
      if (recalled) {
        recallBlock = `\n\n<recall>
以下是你的长期记忆中，与【用户称呼代词】当前消息可能相关的片段。这些是过去对话的摘要，不是【用户称呼代词】现在说的话。
自然地运用这些背景知识来回应，但绝对不要说"你之前说过一样的话"或"你又说了同样的内容"之类的。
即使内容相似，也要当作自然的回忆来处理，而不是指出【用户称呼代词】在重复：
${recalled}
</recall>`;
      }
    }
  } catch (e) { console.warn("[Imprint] Recall error:", e); }

  // Diary awareness
  let diaryBlock = "";
  if (diaryEntries.length > 0) {
    const now = new Date();
    const hour = now.getHours();
    const todayStr = formatDiaryDate(now);
    const todayDiaryExists = diaryEntries.some(e => e.date === todayStr);
    const recentDiaries = [...diaryEntries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2);
    let diarySnippets = recentDiaries.map((d, i) => {
      // Most recent diary gets more content; older ones get less
      const maxLen = i === 0 ? 600 : 300;
      const snippet = d.content.length > maxLen ? d.content.slice(0, maxLen) + "..." : d.content;
      return `[${d.title}]\n${snippet}`;
    }).join("\n\n");
    diaryBlock = `\n\n<diary-info>
你有写日记的习惯，每天20:00写当天的日记。
${todayDiaryExists ? "今天的日记已经写了。" : (hour >= 20 ? "今天的日记还没写，等会就写。" : "今天的日记还没到时间写（20:00才写）。")}
你最近的日记内容（你记得自己写了什么）：
${diarySnippets}
如果【用户称呼代词】问你日记的事，自然地聊。如果【用户称呼代词】在20:00前问今天的日记，告诉【用户称呼代词】还没写呢，到时间了就写。
</diary-info>`;
  }

  // Music context (only when listen-together mode is active + relevant)
  let musicBlock = "";
  if (shouldInjectMusicContext(userText)) {
    musicBlock = buildMusicContext(userText);
  }

  return SYSTEM_PROMPT + timeBlock + stickerBlock + recallBlock + diaryBlock + musicBlock + getGameContext();
}

// --- Helper: log both sides of a turn and extract facts ---
function imprintLogTurn(role, content) {
  ImprintMemory.logTurn(role, content);
  if (memoryDirHandle && memoryEnabled) ImprintMemory.scheduleSave();
}

// === Local Memory Library (本地记忆库) ===

// === Retro-import existing conversation history into Imprint Memory ===
async function retroImportHistory() {
  if (!mimoApiKey) { alert("需要先登录（MiMo API Key）"); return; }

  // Collect all text messages from conversationHistory
  const textMsgs = conversationHistory.filter(m =>
    typeof m.content === "string" && m.content.trim().length > 0
  );

  if (textMsgs.length < 4) {
    alert("历史对话太少（不到4条），先多聊一些再导入");
    return;
  }

  const chunkSize = ImprintMemory.chunkSize;
  const totalChunks = Math.floor(textMsgs.length / chunkSize);
  const hasGoogle = !!googleApiKey;

  const doIt = confirm(
    `★ 导入历史对话到长期记忆\n\n` +
    `历史消息: ${textMsgs.length} 条\n` +
    `将生成约 ${totalChunks} 条记忆摘要\n` +
    `语义向量: ${hasGoogle ? "✅ 会生成（已填 Google Key）" : "❌ 不会生成（未填 Google Key）"}\n\n` +
    `预计耗时: ${totalChunks * 3}-${totalChunks * 5} 秒\n` +
    `（会调用 MiMo API 生成摘要${hasGoogle ? " + Google API 生成向量" : ""}）\n\n` +
    `确定开始？`
  );
  if (!doIt) return;

  const statusBar = document.getElementById("statusBar");
  const origStatus = statusBar.textContent;
  let processed = 0;
  let errors = 0;

  for (let i = 0; i + chunkSize <= textMsgs.length; i += chunkSize) {
    const batch = textMsgs.slice(i, i + chunkSize);
    processed++;
    statusBar.textContent = `🧠 正在导入记忆 ${processed}/${totalChunks}...`;

    const transcript = batch.map(t => {
      const role = t.role === "user" ? "【用户称呼代词简称，如：她/他】" : "【角色称呼代词简称，如：他/她】";
      let text = t.content || "";
      // Try to extract Chinese from JSON responses
      try {
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        if (Array.isArray(parsed)) text = parsed.map(m => m.chinese || m.english).join(" / ");
        else if (parsed.chinese) text = parsed.chinese;
      } catch(e) {}
      return `${role}: ${text.slice(0, 200)}`;
    }).join("\n");

    try {
      const raw = await callMiMoAPI({
        system: `你是记忆摘要助手。把对话片段压缩成一段简洁摘要（中文，50-100字）+关键词列表。
回复严格JSON格式，不要其他内容：
{"summary":"摘要内容","keywords":["关键词1","关键词2"],"category":"facts|events|insights","importance":0.5}
importance 范围 0-1，越重要越高。涉及个人偏好/生日/重要事件给0.8+，普通闲聊给0.3-0.5。`,
        messages: [{ role: "user", content: transcript }],
        max_tokens: 300
      });
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      const chunkId = "retro_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

      // Estimate timestamps from position in history
      const now = Date.now();
      const totalSpan = 30 * 86400000; // assume 30 days of history
      const startFrac = i / textMsgs.length;
      const endFrac = (i + chunkSize) / textMsgs.length;
      const startTime = now - totalSpan * (1 - startFrac);
      const endTime = now - totalSpan * (1 - endFrac);

      ImprintMemory.chunks.push({
        id: chunkId,
        summary: parsed.summary || transcript.slice(0, 100),
        keywords: parsed.keywords || [],
        startTime, endTime,
        rawMessages: batch.map(b => ({ role: b.role, content: b.content.slice(0, 300), time: startTime }))
      });

      ImprintMemory.meta.push({
        id: chunkId,
        importance: parsed.importance || 0.5,
        category: parsed.category || "events",
        recallCount: 0, lastRecall: 0,
        pinned: (parsed.importance || 0.5) >= 0.9,
        tags: parsed.keywords || []
      });

      // Generate embedding
      if (googleApiKey) {
        const vec = await ImprintMemory.embed(
          (parsed.summary || "") + " " + (parsed.keywords || []).join(" ")
        );
        if (vec) ImprintMemory.vectors.push({ id: chunkId, vec });
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 1500));

    } catch (e) {
      console.warn("[Imprint] Retro chunk error:", e);
      errors++;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  ImprintMemory.dirty = true;
  await ImprintMemory.save(memoryDirHandle);
  updateMemoryBtn();

  const msg = `✅ 历史导入完成！\n\n成功: ${processed - errors}/${totalChunks} 条记忆\n${errors > 0 ? `失败: ${errors} 条（可能是限速，稍后重试）\n` : ""}向量: ${ImprintMemory.vectors.length} 个\n\n现在记得你们之前聊过的事了 💕`;
  alert(msg);
  statusBar.textContent = origStatus;
}

async function setupMemoryLib() {
  try {
    if (memoryEnabled && memoryDirHandle) {
      // Already set — offer options
      const chunkInfo = ImprintMemory.chunks.length > 0
        ? `\n当前记忆: ${ImprintMemory.chunks.length} 条摘要, ${ImprintMemory.vectors.length} 个向量`
        : "\n当前记忆: 空";
      const bufInfo = ImprintMemory.turnBuffer.length > 0
        ? `\n待处理消息: ${ImprintMemory.turnBuffer.length} 条`
        : "";
      const action = prompt(`记忆库已连接！${chunkInfo}${bufInfo}\n\n输入操作：\n1 = 更换文件夹\n2 = 断开记忆库\n3 = 立即保存\n4 = 从记忆库加载\n5 = 立即生成记忆摘要\n6 = 执行记忆衰减（预览）\n7 = ★ 导入历史对话到记忆（追加）\n8 = ★ 清空记忆并重新导入\n9 = ★ 重建向量（保留摘要）`, "3");
      if (action === "1") { await pickMemoryDir(); }
      else if (action === "2") { disconnectMemory(); }
      else if (action === "3") { await saveToMemory(); saveSettingsToMemory(); alert("✅ 已保存到记忆库！"); }
      else if (action === "4") { await loadFromMemory(); await restoreAvatarSettings(); await restoreOutfitFromMemory(); await loadSettingsFromMemory(); alert("✅ 已从记忆库加载！"); }
      else if (action === "5") {
        if (ImprintMemory.turnBuffer.length < 4) {
          alert("待处理消息不足（至少需要4条），继续聊天后再试");
        } else {
          await ImprintMemory.summarizeChunk();
          updateMemoryBtn();
          alert(`✅ 已生成摘要！当前共 ${ImprintMemory.chunks.length} 条记忆`);
        }
      }
      else if (action === "6") {
        const stale = ImprintMemory.decay(true);
        if (stale.length === 0) alert("没有需要衰减的记忆");
        else {
          const doIt = confirm(`发现 ${stale.length} 条可衰减的记忆。确定执行衰减？（降低重要度）`);
          if (doIt) { ImprintMemory.decay(false); alert("✅ 衰减完成"); }
        }
      }
      else if (action === "7") {
        await retroImportHistory();
      }
      else if (action === "8") {
        const sure = confirm(`⚠️ 这会清空所有现有记忆（${ImprintMemory.chunks.length} 条摘要、${ImprintMemory.vectors.length} 个向量），然后从聊天历史重新导入。\n\n确定清空并重新导入？`);
        if (sure) {
          ImprintMemory.chunks = [];
          ImprintMemory.vectors = [];
          ImprintMemory.meta = [];
          ImprintMemory.edges = [];
          ImprintMemory.turnBuffer = [];
          ImprintMemory.dirty = true;
          await ImprintMemory.save(memoryDirHandle);
          updateMemoryBtn();
          await retroImportHistory();
        }
      }
      else if (action === "9") {
        if (!googleApiKey) { alert("需要先填写 Google AI API Key"); return; }
        if (ImprintMemory.chunks.length === 0) { alert("没有记忆摘要，请先导入"); return; }
        const sure = confirm(`将为 ${ImprintMemory.chunks.length} 条现有摘要重新生成向量。\n摘要内容不变，只更新向量。\n\n预计耗时 ${ImprintMemory.chunks.length * 1}-${ImprintMemory.chunks.length * 2} 秒\n\n开始？`);
        if (!sure) return;
        const statusBar = document.getElementById("statusBar");
        const orig = statusBar.textContent;
        ImprintMemory.vectors = [];
        let ok = 0, fail = 0;
        for (let i = 0; i < ImprintMemory.chunks.length; i++) {
          const chunk = ImprintMemory.chunks[i];
          statusBar.textContent = `🧠 重建向量 ${i+1}/${ImprintMemory.chunks.length}...`;
          const text = (chunk.summary || "") + " " + (chunk.keywords || []).join(" ");
          const vec = await ImprintMemory.embed(text);
          if (vec) { ImprintMemory.vectors.push({ id: chunk.id, vec }); ok++; }
          else { fail++; }
          await new Promise(r => setTimeout(r, 500));
        }
        ImprintMemory.dirty = true;
        await ImprintMemory.save(memoryDirHandle);
        updateMemoryBtn();
        statusBar.textContent = orig;
        alert(`✅ 向量重建完成！\n成功: ${ok}  失败: ${fail}\n现在共 ${ImprintMemory.vectors.length} 个向量`);
      }
      return;
    }
    await pickMemoryDir();
  } catch(e) {
    console.warn("Memory lib error:", e);
    alert("记忆库设置失败: " + e.message);
  }
}

async function pickMemoryDir() {
  try {
    memoryDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    memoryEnabled = true;
    updateMemoryBtn();
    await AudioDB.save("_memoryDirHandle", memoryDirHandle);

    // Check if folder already has data
    let hasExistingData = false;
    try {
      await memoryDirHandle.getFileHandle("chat-data.json");
      hasExistingData = true;
    } catch(e) {}

    if (hasExistingData) {
      const choice = confirm("检测到记忆库文件夹中已有数据。\n\n确定 = 从文件夹加载（覆盖当前聊天）\n取消 = 把当前聊天保存到文件夹（覆盖文件夹）");
      if (choice) {
        showMemoryLoader("正在从记忆库加载...");
        updateMemoryLoader(15, "正在读取数据...");
        await loadFromMemory();
        updateMemoryLoader(85, "正在恢复设置...");
        await restoreAvatarSettings();
        await restoreOutfitFromMemory();
        await loadSettingsFromMemory();
        await loadStickers();
        hideMemoryLoader();
        document.getElementById("statusBar").textContent = "✅ 已从记忆库加载";
      } else {
        await saveToMemory();
        saveSettingsToMemory();
        document.getElementById("statusBar").textContent = "✅ 已保存到记忆库";
      }
    } else {
      // Empty folder — migrate current data
      await saveToMemory();
      saveSettingsToMemory();
      document.getElementById("statusBar").textContent = "✅ 记忆库已连接，数据已迁移";
    }

    scheduleMemorySave();
    setTimeout(() => {
      document.getElementById("statusBar").textContent = "在线 · 语音已连接";
    }, 2500);
  } catch(e) {
    if (e.name === "AbortError") return;
    throw e;
  }
}

function disconnectMemory() {
  memoryDirHandle = null;
  memoryEnabled = false;
  updateMemoryBtn();
}

function updateMemoryBtn() {
  const btn = document.getElementById("memoryBtn");
  if (memoryEnabled) {
    const chunkCount = ImprintMemory.chunks.length;
    btn.textContent = chunkCount > 0 ? `🧠 记忆:${chunkCount}条` : "📁 记忆库:开";
    btn.style.opacity = "1";
  } else {
    btn.textContent = "📁 记忆库";
    btn.style.opacity = "0.6";
  }
}

async function saveToMemory() {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    // Verify permission
    const perm = await memoryDirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;

    // 1. Save chat data (JSON)
    const chatFile = await memoryDirHandle.getFileHandle("chat-data.json", { create: true });
    const chatWriter = await chatFile.createWritable();
    await chatWriter.write(safeStringify({
      version: 2,
      migrationV2Done: true,
      savedAt: new Date().toISOString(),
      conversationHistory,
      chatMessages,
      currentGame,
      rpState: rpActive ? { active: true, config: rpConfig, convHistory: rpConvHistory } : null
    }, null, 2));
    await chatWriter.close();

    // 2. Save audio/voice/screenshot blobs
    const blobsDir = await memoryDirHandle.getDirectoryHandle("blobs", { create: true });
    const allIds = [];
    for (const msg of chatMessages) {
      if (msg.audioId) allIds.push(msg.audioId);
      if (msg.voiceAudioId) allIds.push(msg.voiceAudioId);
      if (msg.peekId) allIds.push(msg.peekId);
      if (msg.imgId) allIds.push(msg.imgId);
    }

    // Check which blobs already exist
    for (const id of allIds) {
      const ext = id.startsWith("peek_") ? ".jpg" : id.startsWith("img_") ? ".png" : ".webm";
      try {
        await blobsDir.getFileHandle(id + ext);
        continue; // Already saved
      } catch(e) {} // Not saved yet

      const blob = await AudioDB.load(id);
      if (blob) {
        const fileHandle = await blobsDir.getFileHandle(id + ext, { create: true });
        const writer = await fileHandle.createWritable();
        await writer.write(blob);
        await writer.close();
      }
    }

    console.log("Memory saved:", allIds.length, "blobs");
    // Also save imprint memory data
    await ImprintMemory.save(memoryDirHandle);
    // Also save music history
    await saveMusicHistory();
  } catch(e) {
    console.warn("Save to memory error:", e);
  }
}

async function loadFromMemory() {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;

    // 1. Load chat data
    updateMemoryLoader(25, "正在读取聊天记录...");
    const chatFile = await memoryDirHandle.getFileHandle("chat-data.json");
    const file = await chatFile.getFile();
    const data = JSON.parse(await file.text());

    if (data.conversationHistory) conversationHistory = data.conversationHistory;
    if (data.chatMessages) chatMessages = data.chatMessages;
    if (data.currentGame) currentGame = data.currentGame;
    // Restore roleplay state
    if (data.rpState && data.rpState.active && data.rpState.config) {
      rpActive = true;
      rpConfig = data.rpState.config;
      rpConvHistory = data.rpState.convHistory || [];
    }
    const _savedMigrationDone = data.migrationV2Done || false;
    memoryLoaded = true;

    // Load imprint memory data
    updateMemoryLoader(35, "正在加载长期记忆...");
    await ImprintMemory.load(memoryDirHandle);

    // 2. Clear IndexedDB (it's only a session cache, real data lives in memory folder)
    updateMemoryLoader(45, "正在同步缓存...");
    const savedHandle = memoryDirHandle;
    await AudioDB.clear();
    await AudioDB.save("_memoryDirHandle", savedHandle);

    // 3. Load blobs ONLY for the most recent CHAT_PAGE_SIZE messages (lazy loading)
    updateMemoryLoader(50, "正在加载最近的媒体文件...");
    let blobsDir;
    try { blobsDir = await memoryDirHandle.getDirectoryHandle("blobs"); }
    catch(e) { blobsDir = null; }

    if (blobsDir) {
      const recentMessages = chatMessages.slice(-CHAT_PAGE_SIZE);
      const neededIds = collectBlobIds(recentMessages);
      let loaded = 0;
      for (const id of neededIds) {
        const ext = id.startsWith("peek_") ? ".jpg" : id.startsWith("img_") ? ".png" : ".webm";
        try {
          const fh = await blobsDir.getFileHandle(id + ext);
          const f = await fh.getFile();
          await AudioDB.save(id, f);
          loaded++;
          const blobPercent = 50 + Math.floor((loaded / Math.max(neededIds.length, 1)) * 20);
          updateMemoryLoader(blobPercent, `正在加载媒体文件 ${loaded}/${neededIds.length}...`);
        } catch(e) {}
      }
    }

    // Load stickers BEFORE rendering so findSticker() works
    updateMemoryLoader(70, "正在加载表情包...");
    await loadStickers();

    // Load diary entries
    updateMemoryLoader(72, "正在加载日记...");
    await loadDiariesFromMemory();

    // Load music library
    await loadMusicFromMemory();

    // Migrate: recover bot sticker/file data from conversationHistory for old messages
    // This migration only runs ONCE — after that, data is saved directly in chatMessages
    let _needResave = false;
    const _migrationAlreadyDone = _savedMigrationDone;
    if (!_migrationAlreadyDone) {
    try {
      // Collect sticker and file info from assistant responses in conversationHistory
      // Track which conversationHistory index each meta came from for alignment verification
      const assistantMeta = []; // [{sticker, file, histIdx}] in order of bot messages
      for (let hi = 0; hi < conversationHistory.length; hi++) {
        const ch = conversationHistory[hi];
        if (ch.role !== "assistant") continue;
        try {
          const clean = (ch.content || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(clean);
          const msgs = Array.isArray(parsed) ? parsed : [parsed];
          for (const m of msgs) {
            if (m.english && m.chinese) {
              assistantMeta.push({
                sticker: m.sticker || null,
                file: (m.file && m.file.name && m.file.content) ? m.file : null,
                histIdx: hi,
                english: (m.english || "").slice(0, 50) // for alignment check
              });
            }
          }
        } catch(e) {
          const stickerMatch = (ch.content || "").match(/"sticker"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          const engMatches = (ch.content || "").match(/"english"\s*:/g);
          const count = engMatches ? engMatches.length : 1;
          for (let i = 0; i < count; i++) {
            assistantMeta.push({
              sticker: i === count - 1 && stickerMatch ? stickerMatch[1].replace(/\\"/g, '"') : null,
              file: null,
              histIdx: hi,
              english: ""
            });
          }
        }
      }

      // Match to bot chatMessages in order, with alignment verification
      let metaIdx = 0;
      for (const msg of chatMessages) {
        if (msg.role === "bot" && metaIdx < assistantMeta.length) {
          const meta = assistantMeta[metaIdx];
          // Alignment check: verify the english text roughly matches
          const msgEng = (msg.english || "").slice(0, 50);
          const metaEng = meta.english || "";
          const aligned = !metaEng || !msgEng || 
            msgEng.includes(metaEng.slice(0, 20)) || metaEng.includes(msgEng.slice(0, 20));
          
          if (aligned) {
            // Recover sticker (only if no file — don't confuse files with stickers)
            if (meta.sticker && !msg.stickerName && !meta.file) {
              msg.stickerName = meta.sticker;
              _needResave = true;
            }
            // Recover file
            if (meta.file && !msg.fileName) {
              msg.fileName = meta.file.name;
              msg.fileContent = meta.file.content;
              _needResave = true;
            }
          }
          metaIdx++;
        }
      }
      // Mark migration as done (flag saved in chat-data.json via scheduleMemorySave)
      _needResave = true;
    } catch(e) { console.warn("Sticker/file migration from history error:", e); }
    } // end migration guard

    // Migrate: recover user file names from text pattern
    for (const msg of chatMessages) {
      if (msg.role === "user" && !msg.fileName && msg.text) {
        const fMatch = msg.text.match(/\[发了文件[:：]\s*(.+?)\]/);
        if (fMatch) {
          msg.fileName = fMatch[1].trim();
          _needResave = true;
        }
      }
    }

    // Backfill stickerDataUrl for messages that have stickerName but no data
    for (const msg of chatMessages) {
      const sName = msg.stickerName;
      if (sName && !msg.stickerDataUrl) {
        const st = findSticker(sName);
        if (st) {
          try {
            const resp = await fetch(st.url);
            const blob = await resp.blob();
            msg.stickerDataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
            _needResave = true;
          } catch(e) {}
        }
      }
    }
    if (_needResave) scheduleMemorySave();

    // Re-render chat (lazy: only last CHAT_PAGE_SIZE)
    updateMemoryLoader(72, `正在渲染聊天记录 (${chatMessages.length}条)...`);
    const area = document.getElementById("chatArea");
    area.innerHTML = "";
    if (chatMessages.length === 0) {
      area.innerHTML = `<div class="empty-state" id="emptyState">
        <span>💬</span><div>说点什么吧，我在听</div></div>`;
    } else {
      chatRenderStart = Math.max(0, chatMessages.length - CHAT_PAGE_SIZE);
      const slice = chatMessages.slice(chatRenderStart);
      for (const msg of slice) {
        await renderOneMessage(msg);
      }
      if (chatRenderStart > 0) insertLoadMoreBanner();
      if (!_scrollListenerAdded) {
        area.addEventListener("scroll", onChatScrollTop);
        _scrollListenerAdded = true;
      }
    }
    updateMemoryBtn();
    updateGameBanner();
    // Restore roleplay banner if active
    if (rpActive && rpConfig) {
      document.getElementById("rpBanner").style.display = "flex";
      document.getElementById("rpBannerChars").textContent = `ta: ${rpConfig.botCharacter.slice(0,15)} | 你: ${rpConfig.userCharacter.slice(0,15)}`;
      document.getElementById("statusBar").textContent = "在线 · 角色扮演中";
    }
  } catch(e) {
    console.warn("Load from memory error:", e);
    alert("从记忆库加载失败: " + e.message);
  }
}

// Auto-save to memory library — immediate
let memorySaveTimer = null;
function scheduleMemorySave() {
  if (!memoryEnabled || !memoryDirHandle) return;
  saveToMemory();
}

// Try to restore memory dir handle on init and load data
async function tryRestoreMemoryHandle() {
  try {
    const handle = await AudioDB.load("_memoryDirHandle");
    if (handle && handle instanceof FileSystemDirectoryHandle) {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        showMemoryLoader("正在连接记忆库...");
        updateMemoryLoader(10, "正在验证权限...");
        memoryDirHandle = handle;
        memoryEnabled = true;
        updateMemoryBtn();
        updateMemoryLoader(20, "正在读取聊天记录...");
        await loadFromMemory();
        updateMemoryLoader(80, "正在恢复设置...");
        await restoreAvatarSettings();
        await restoreOutfitFromMemory();
        await loadSettingsFromMemory();
        await loadStickers();
        scheduleMemorySave();
        updateMemoryLoader(100, "加载完成 ✓");
        console.log("Memory library auto-loaded from:", handle.name);
        hideMemoryLoader();
      } else if (perm === "prompt") {
        memoryDirHandle = handle;
        updateMemoryBtn();
        document.getElementById("memoryBtn").textContent = "📁 点击重连";
        document.getElementById("memoryBtn").onclick = async function() {
          const p = await handle.requestPermission({ mode: "readwrite" });
          if (p === "granted") {
            showMemoryLoader("正在重新连接记忆库...");
            updateMemoryLoader(20, "正在读取数据...");
            memoryEnabled = true;
            updateMemoryBtn();
            await loadFromMemory();
            updateMemoryLoader(80, "正在恢复设置...");
            await restoreAvatarSettings();
            await restoreOutfitFromMemory();
            await loadSettingsFromMemory();
        await loadStickers();
            scheduleMemorySave();
            document.getElementById("memoryBtn").onclick = setupMemoryLib;
            hideMemoryLoader();
          }
        };
      }
    }
  } catch(e) {
    console.warn("Memory restore error:", e);
    hideMemoryLoader();
  }
}

// === Settings persistence (theme, proactive, etc.) → memory library ===
let _settingsSaveTimer = null;
function saveSettingsToMemory() {
  if (!memoryEnabled || !memoryDirHandle) return;
  if (_settingsSaveTimer) clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(async () => {
    try {
      const perm = await memoryDirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") return;
      const currentTheme = document.documentElement.getAttribute("data-theme") || "default";
      const settings = {
        theme: currentTheme,
        proactive: proactiveEnabled ? "1" : "0",
        webSearch: webSearchEnabled ? "1" : "0",
        chatModel: chatModel,
        keys: {
          openai: mimoApiKey || "",
          google: googleApiKey || ""
        }
      };
      const fh = await memoryDirHandle.getFileHandle("settings.json", { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(settings));
      await w.close();
    } catch(e) { console.warn("Save settings error:", e); }
  }, 500);
}

async function loadSettingsFromMemory() {
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    const fh = await memoryDirHandle.getFileHandle("settings.json");
    const f = await fh.getFile();
    const settings = JSON.parse(await f.text());
    if (settings.theme) {
      setTheme(settings.theme);
    }
    if (settings.proactive !== undefined) {
      proactiveEnabled = settings.proactive !== "0";
      const pBtn = document.getElementById("proactiveBtn");
      if (pBtn) {
        pBtn.textContent = proactiveEnabled ? "💬 主动消息:开" : "💬 主动消息:关";
        pBtn.style.opacity = proactiveEnabled ? "1" : "0.5";
      }
    }
    if (settings.webSearch !== undefined) {
      webSearchEnabled = settings.webSearch !== "0";
      const wBtn = document.getElementById("webSearchBtn");
      if (wBtn) {
        wBtn.textContent = webSearchEnabled ? "🔍 联网:开" : "🔍 联网:关";
        wBtn.style.opacity = webSearchEnabled ? "1" : "0.5";
      }
    }
    // Restore API keys from memory library
    if (settings.chatModel) {
      chatModel = settings.chatModel;
      const mBtn = document.getElementById("modelBtn");
      if (mBtn) {
        const isPro = chatModel === MIMO_MODEL_PRO;
        mBtn.textContent = isPro ? "🧠 Pro" : "⚡ Flash";
        mBtn.title = isPro ? "当前: Pro（更强）\n点击切换到 Flash" : "当前: Flash（更快）\n点击切换到 Pro";
      }
    }
    if (settings.keys) {
      const k = settings.keys;
      if (k.openai) { mimoApiKey = k.openai; document.getElementById("mimoKey").value = k.openai; }
      if (k.google) { googleApiKey = k.google; document.getElementById("googleKey").value = k.google; }
      if (k.eleven && !k.openai) { mimoApiKey = k.eleven; document.getElementById("mimoKey").value = k.eleven; }
      checkKeys();
    }
  } catch(e) { /* settings.json doesn't exist yet = use defaults */ }
}
