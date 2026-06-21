// === Utility Functions ===

function safeStringify(obj, replacer, space) {
  let raw = JSON.stringify(obj, replacer, space);
  raw = raw.replace(/\\u[dD][89aAbB][0-9a-fA-F]{2}(?!\\u[dD][cCdDeEfF][0-9a-fA-F]{2})/g, '');
  raw = raw.replace(/(?<!\\u[dD][89aAbB][0-9a-fA-F]{2})\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g, '');
  let clean = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      const next = i + 1 < raw.length ? raw.charCodeAt(i + 1) : 0;
      if (next >= 0xDC00 && next <= 0xDFFF) {
        clean += raw[i] + raw[i + 1];
        i++;
      }
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
    } else {
      clean += raw[i];
    }
  }
  return clean;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}


function cleanTags(text) {
  return (text || "")
    .replace(/\[[^\]]*\]\s*/g, "")           // [tag] format
    .replace(/\*[^*]+\*\s*/g, "")            // *action* format
    .replace(/\.{0,3}\s*sniff\.{0,3}\s*/gi, " ")  // sniff...
    .replace(/\.{0,3}\s*sigh\.{0,3}\s*/gi, " ")   // sigh...
    .replace(/\.{0,3}\s*gulp\.{0,3}\s*/gi, " ")   // gulp...
    .replace(/\.{0,3}\s*hiccup\.{0,3}\s*/gi, " ") // hiccup...
    .replace(/\.{0,3}\s*huff\.{0,3}\s*/gi, " ")   // huff...
    .replace(/\.{0,3}\s*pout\.{0,3}\s*/gi, " ")   // pout...
    .replace(/\s{2,}/g, " ").trim();
}


function cleanForTTS(text) {
  return (text || "")
    .replace(/\*[^*]+\*\s*/g, "")
    .replace(/\bsniff\b\.{0,3}/gi, "")
    .replace(/\bsigh\b\.{0,3}/gi, "")
    .replace(/\bgulp\b\.{0,3}/gi, "")
    .replace(/\bhiccup\b\.{0,3}/gi, "")
    .replace(/\bhuff\b\.{0,3}/gi, "")
    .replace(/\bpout\b\.{0,3}/gi, "")
    .replace(/\s{2,}/g, " ").trim();
}

function formatMsgTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const HH = pad(d.getHours()), MM = pad(d.getMinutes());
  const M = d.getMonth() + 1, D = d.getDate();
  // Today: just time
  if (d.toDateString() === now.toDateString()) return `${HH}:${MM}`;
  // This year: M/D HH:MM
  if (d.getFullYear() === now.getFullYear()) return `${M}/${D} ${HH}:${MM}`;
  // Other year
  return `${d.getFullYear()}/${M}/${D} ${HH}:${MM}`;
}


function setLoading(show) {
  const existing = document.getElementById("loadingBubble");
  if (existing) existing.remove();

  if (show) {
    const area = document.getElementById("chatArea");
    const row = document.createElement("div");
    row.className = "msg-row bot";
    row.id = "loadingBubble";
    row.innerHTML = `<div class="loading-bubble">
      <span class="dot">·</span><span class="dot">·</span><span class="dot">·</span>
    </div>`;
    area.appendChild(row);
    area.scrollTop = area.scrollHeight;
  }

  document.getElementById("chatInput").disabled = show;
  document.getElementById("sendBtn").disabled = show;
}


function showError(msg) {
  const area = document.getElementById("chatArea");
  const div = document.createElement("div");
  div.className = "error-msg";
  div.textContent = msg;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}


// Content filter fallback - random cute lyrics
function getRandomLyricFallback() {
  const lyrics = [
    /* 【在此填入角色的哼歌/唱歌台词列表，格式如下：
    { english: "[singing] 英文歌词~", chinese: "🎵 中文歌词~ 🎶" },
    建议准备20-50条，涵盖开心、甜蜜、搞笑、温柔等不同情绪
    歌词内容应符合角色性格和与用户的关系设定 */
    { english: "[singing] La la la~ you make me smile~ every single day~", chinese: "🎵 啦啦啦~ 你让我微笑~ 每一天~ 🎶" },
    { english: "[singing softly] Hm hm hm~ thinking of you~ wondering what you do~", chinese: "🎵 嗯嗯嗯~ 想着你~ 你在做什么呢~ 🎶" },
    { english: "[singing] Do re mi~ fa so la~ ti do~ life is better with you~", chinese: "🎵 哆来咪~ 发嗦拉~ 西哆~ 有你生活更美好~ 🎶" },
  ];
  return [lyrics[Math.floor(Math.random() * lyrics.length)]];
}


function showToast(msg, duration) {
  let el = document.getElementById("globalToast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.id = "globalToast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), duration || 1200);
}
