// ============================================================
// === Search History — 搜索历史消息 ===
// ============================================================
let searchDebounce = null;

function toggleSearchBar() {
  const bar = document.getElementById("searchBar");
  const isOpen = bar.classList.contains("open");
  bar.classList.toggle("open");
  if (!isOpen) {
    const inp = document.getElementById("searchInput");
    inp.value = "";
    document.getElementById("searchResults").innerHTML = "";
    setTimeout(() => inp.focus(), 100);
  }
}

function onSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const query = document.getElementById("searchInput").value.trim();
    if (query.length < 2) { document.getElementById("searchResults").innerHTML = ""; return; }
    const results = searchAllSources(query);
    renderSearchResults(results, query);
  }, 250);
}

// --- Comprehensive search across ALL data sources ---
function searchAllSources(query) {
  const q = query.toLowerCase();
  const results = [];
  const seenTexts = new Set(); // dedup across sources

  // === Source 1: chatMessages (primary — can jump to) ===
  for (let i = 0; i < chatMessages.length; i++) {
    const msg = chatMessages[i];
    let text = "";
    if (msg.role === "user") text = msg.text || "";
    else if (msg.role === "bot" || msg.role === "assistant") text = msg.chinese || msg.english || "";
    else if (msg.role === "system") text = msg.text || "";
    if (!text) continue;
    if (text.toLowerCase().includes(q)) {
      const key = (msg.role + ":" + text.slice(0, 60)).toLowerCase();
      seenTexts.add(key);
      results.push({ index: i, role: msg.role, text, time: msg.time, source: "chat", jumpable: true });
    }
  }

  // === Source 2: conversationHistory (covers messages not in chatMessages) ===
  for (let i = 0; i < conversationHistory.length; i++) {
    const msg = conversationHistory[i];
    let raw = typeof msg.content === "string" ? msg.content : "";
    if (!raw) continue;

    // For assistant (bot) messages, try to extract Chinese from JSON
    let searchableTexts = [raw];
    if (msg.role === "assistant") {
      try {
        const clean = raw.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed)) {
          searchableTexts = parsed.map(m => m.chinese || m.english || "").filter(Boolean);
        } else if (parsed.chinese) {
          searchableTexts = [parsed.chinese];
        }
      } catch(e) {
        // Not JSON — search raw text (covers roleplay, game, etc.)
      }
    }

    for (const text of searchableTexts) {
      if (!text.toLowerCase().includes(q)) continue;
      const key = ((msg.role === "user" ? "user" : "bot") + ":" + text.slice(0, 60)).toLowerCase();
      if (seenTexts.has(key)) continue; // skip if already found in chatMessages
      seenTexts.add(key);

      // Try to find matching chatMessage index for jumping
      let matchIdx = -1;
      const role = msg.role === "user" ? "user" : "bot";
      const textSnippet = text.slice(0, 40);
      for (let ci = 0; ci < chatMessages.length; ci++) {
        const cm = chatMessages[ci];
        if (cm.role !== role) continue;
        const cmText = cm.role === "user" ? (cm.text || "") : (cm.chinese || cm.english || "");
        if (cmText.includes(textSnippet)) { matchIdx = ci; break; }
      }

      results.push({
        index: matchIdx,
        role: role,
        text: text.slice(0, 300),
        time: null,
        source: "history",
        jumpable: matchIdx >= 0
      });
    }
  }

  // === Source 3: ImprintMemory chunks (long-term memory summaries) ===
  if (ImprintMemory && ImprintMemory.chunks) {
    for (const chunk of ImprintMemory.chunks) {
      const summaryText = (chunk.summary || "") + " " + (chunk.keywords || []).join(" ");
      if (!summaryText.toLowerCase().includes(q)) continue;
      const key = ("memory:" + (chunk.summary || "").slice(0, 60)).toLowerCase();
      if (seenTexts.has(key)) continue;
      seenTexts.add(key);
      results.push({
        index: -1,
        role: "memory",
        text: chunk.summary || "",
        time: chunk.endTime || chunk.startTime || null,
        source: "memory",
        jumpable: false,
        keywords: chunk.keywords
      });
    }
  }

  // Sort: jumpable results first, then by time (newest first)
  results.sort((a, b) => {
    if (a.jumpable !== b.jumpable) return a.jumpable ? -1 : 1;
    return (b.time || 0) - (a.time || 0);
  });

  return results.slice(0, 80);
}

function renderSearchResults(results, query) {
  const container = document.getElementById("searchResults");
  if (results.length === 0) {
    container.innerHTML = '<div class="search-no-results">没有找到相关消息</div>';
    return;
  }

  // Count by source
  const chatCount = results.filter(r => r.source === "chat").length;
  const histCount = results.filter(r => r.source === "history").length;
  const memCount = results.filter(r => r.source === "memory").length;

  let headerHtml = `<div style="padding:6px 10px;font-size:11px;color:var(--text-dim);border-bottom:1px solid var(--border)">`;
  headerHtml += `共 ${results.length} 条结果`;
  if (histCount > 0 || memCount > 0) {
    const parts = [];
    if (chatCount > 0) parts.push(`聊天 ${chatCount}`);
    if (histCount > 0) parts.push(`历史 ${histCount}`);
    if (memCount > 0) parts.push(`记忆 ${memCount}`);
    headerHtml += `（${parts.join("·")}）`;
  }
  headerHtml += `</div>`;
  container.innerHTML = headerHtml;

  const headerName = document.getElementById("headerName")?.textContent || characterProfile.botName || "AI";

  for (const res of results) {
    const item = document.createElement("div");
    item.className = "search-result-item";
    if (!res.jumpable) item.style.opacity = "0.75";

    let roleLabel, roleClass;
    if (res.role === "user") { roleLabel = "你"; roleClass = "user"; }
    else if (res.role === "memory") { roleLabel = "🧠 记忆"; roleClass = "bot"; }
    else if (res.role === "system") { roleLabel = "系统"; roleClass = "bot"; }
    else { roleLabel = headerName; roleClass = "bot"; }

    const timeStr = res.time ? formatMsgTime(res.time) : "";

    // Source tag
    let sourceTag = "";
    if (res.source === "history" && !res.jumpable) sourceTag = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(196,149,106,0.15);color:var(--accent)">历史记录</span>';
    else if (res.source === "memory") sourceTag = ' <span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(100,180,220,0.15);color:var(--text-secondary)">长期记忆</span>';

    // Highlight matching text
    const previewText = res.text.slice(0, 150);
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const highlighted = escapeHtml(previewText).replace(regex, '<mark>$1</mark>');

    // Keywords for memory results
    let keywordHtml = "";
    if (res.keywords && res.keywords.length > 0) {
      keywordHtml = `<div style="margin-top:3px;font-size:10px;color:var(--text-dim)">${res.keywords.map(k => '#' + k).join(' ')}</div>`;
    }

    item.innerHTML = `<div class="search-result-role ${roleClass}">${escapeHtml(roleLabel)} ${timeStr ? '· ' + timeStr : ''}${sourceTag}</div><div class="search-result-preview">${highlighted}</div>${keywordHtml}`;

    if (res.jumpable) {
      const idx = res.index;
      item.onclick = () => jumpToMessage(idx);
      item.title = "点击跳转到该消息";
    } else {
      item.style.cursor = "default";
      item.title = res.source === "memory" ? "长期记忆摘要，无法跳转" : "历史消息，无法定位到具体位置";
    }

    container.appendChild(item);
  }
}

async function jumpToMessage(targetIdx) {
  if (targetIdx < 0 || targetIdx >= chatMessages.length) return;
  toggleSearchBar(); // Close search bar

  const area = document.getElementById("chatArea");

  // Calculate render range: center target with context
  const contextBefore = 30;
  const contextAfter = 70;
  const newStart = Math.max(0, targetIdx - contextBefore);
  const newEnd = Math.min(chatMessages.length, targetIdx + contextAfter);
  const slice = chatMessages.slice(newStart, newEnd);

  // Load blobs for this section
  await loadBlobsForMessages(slice);

  // Clear and re-render
  area.innerHTML = "";
  chatRenderStart = newStart;

  if (chatRenderStart > 0) insertLoadMoreBanner();

  for (let i = 0; i < slice.length; i++) {
    await renderOneMessage(slice[i]);
  }

  // Re-attach scroll listener
  if (!_scrollListenerAdded) {
    area.addEventListener("scroll", onChatScrollTop);
    _scrollListenerAdded = true;
  }

  // Find the target msg-row and scroll to it
  // The target is at position (targetIdx - newStart) in the rendered list
  const targetPos = targetIdx - newStart;
  const msgRows = area.querySelectorAll(".msg-row, .rp-system-msg, .peek-row");
  let allNodes = [];
  for (const child of area.children) {
    if (child.id === "loadMoreBanner") continue;
    allNodes.push(child);
  }

  if (targetPos < allNodes.length) {
    const targetNode = allNodes[targetPos];
    targetNode.scrollIntoView({ block: "center", behavior: "smooth" });
    targetNode.classList.add("search-highlight");
    setTimeout(() => targetNode.classList.remove("search-highlight"), 2500);
  }

  // Show "return to latest" button if we're not at the end
  if (newEnd < chatMessages.length) {
    document.getElementById("jumpBackBtn").classList.add("visible");
  }
}

async function jumpBackToLatest() {
  document.getElementById("jumpBackBtn").classList.remove("visible");
  const area = document.getElementById("chatArea");
  area.innerHTML = "";

  chatRenderStart = Math.max(0, chatMessages.length - CHAT_PAGE_SIZE);
  const slice = chatMessages.slice(chatRenderStart);

  await loadBlobsForMessages(slice);

  if (chatRenderStart > 0) insertLoadMoreBanner();
  for (const msg of slice) { await renderOneMessage(msg); }

  if (!_scrollListenerAdded) {
    area.addEventListener("scroll", onChatScrollTop);
    _scrollListenerAdded = true;
  }

  area.scrollTop = area.scrollHeight;
}

