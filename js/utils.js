// === Utility Functions ===
// Note: safeStringify() is defined in storage.js

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


function showError(msg) {
  const area = document.getElementById("chatArea");
  const div = document.createElement("div");
  div.className = "error-msg";
  div.textContent = msg;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
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
