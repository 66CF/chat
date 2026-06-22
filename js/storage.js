const AudioDB = {
  db: null,
  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("vbc_audio_db", 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore("audios");
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async save(id, blob) {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("audios", "readwrite");
        tx.objectStore("audios").put(blob, id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch(e) { console.error("AudioDB save error:", e); }
  },
  async load(id) {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("audios", "readonly");
        const req = tx.objectStore("audios").get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch(e) { console.error("AudioDB load error:", e); return null; }
  },
  async delete(id) {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("audios", "readwrite");
        tx.objectStore("audios").delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch(e) { console.error("AudioDB delete error:", e); }
  },
  async clear() {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("audios", "readwrite");
        tx.objectStore("audios").clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch(e) { console.error("AudioDB clear error:", e); }
  }
};

// === LocalStorage ===
function saveKeys() {
  if (document.getElementById("rememberKeys").checked) {
    localStorage.setItem("vbc_mimo_key", mimoApiKey);
    localStorage.setItem("vbc_google_key", googleApiKey);
  }
}
function loadKeys() {
  const ek = localStorage.getItem("vbc_eleven_key");
  const ok = localStorage.getItem("vbc_mimo_key");
  const ak = localStorage.getItem("vbc_openai_key");
  const gk = localStorage.getItem("vbc_google_key");
  if (ok) document.getElementById("mimoKey").value = ok;
  else if (ak) { document.getElementById("mimoKey").value = ak; localStorage.setItem("vbc_mimo_key", ak); }
  else if (ek) { document.getElementById("mimoKey").value = ek; }
  if (gk) document.getElementById("googleKey").value = gk;
  checkKeys();
}
// Safe JSON.stringify that removes unpaired Unicode surrogates
// (kaomoji/emoji can introduce these, causing "no low surrogate" API errors)
function safeStringify(obj, replacer, space) {
  let raw = JSON.stringify(obj, replacer, space);
  // Remove unpaired surrogate escape sequences first
  // High surrogate not followed by low surrogate
  raw = raw.replace(/\\u[dD][89aAbB][0-9a-fA-F]{2}(?!\\u[dD][cCdDeEfF][0-9a-fA-F]{2})/g, '');
  // Orphaned low surrogate
  raw = raw.replace(/(?<!\\u[dD][89aAbB][0-9a-fA-F]{2})\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g, '');
  // Also clean actual surrogate characters (belt and suspenders)
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
      // skip
    } else {
      clean += raw[i];
    }
  }
  return clean;
}

function saveChatHistory() {
  // Save to memory library folder only (no more localStorage)
  if (memoryEnabled && memoryDirHandle) {
    scheduleMemorySave();
  }
}
function loadChatHistory() {
  // Loading is handled by tryRestoreMemoryHandle → loadFromMemory
  // This function is now a no-op; kept for compatibility
}
