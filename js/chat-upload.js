// === Image Messages ===
let pendingImage = null; // { dataUrl, base64, mediaType }

// === Attach Menu (image + file picker) ===
function toggleAttachMenu() {
  document.getElementById("attachMenu").classList.toggle("visible");
}
function pickImage() {
  document.getElementById("attachMenu").classList.remove("visible");
  document.getElementById("imgFileInput").click();
}
function pickFile() {
  document.getElementById("attachMenu").classList.remove("visible");
  document.getElementById("fileInput").click();
}
// Close attach menu when clicking outside
document.addEventListener("click", (e) => {
  const menu = document.getElementById("attachMenu");
  const btn = document.getElementById("attachBtn");
  if (menu && !menu.contains(e.target) && e.target !== btn) {
    menu.classList.remove("visible");
  }
});

function handlePaste(event) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      event.preventDefault();
      const file = item.getAsFile();
      processImageFile(file);
      return;
    }
  }
}

function handleImageFile(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) processImageFile(file);
}

function processImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const base64 = dataUrl.split(",")[1];
    const mediaType = file.type || "image/png";
    pendingImage = { dataUrl, base64, mediaType };
    showImagePreview(dataUrl);
  };
  reader.readAsDataURL(file);
}

function showImagePreview(dataUrl) {
  document.getElementById("imgPreviewThumb").src = dataUrl;
  document.getElementById("imgPreviewBar").style.display = "flex";
  document.getElementById("chatInput").placeholder = "输入文字一起发送，或直接点发送...";
  document.getElementById("chatInput").focus();
}

function clearImagePreview() {
  pendingImage = null;
  document.getElementById("imgPreviewBar").style.display = "none";
  document.getElementById("imgPreviewThumb").src = "";
  document.getElementById("chatInput").placeholder = "跟我说话...";
}

// === File Upload & Download ===
let pendingFile = null; // { name, content, type, isPdf, isDoc, base64 }

const TEXT_EXTENSIONS = new Set([
  // 文本
  "txt","md","markdown","rst","rtf","log","nfo","readme",
  // 编程语言
  "js","jsx","ts","tsx","py","pyw","rb","php","java","kt","kts","scala","groovy",
  "c","cpp","cc","cxx","h","hpp","hxx","cs","fs","fsx",
  "go","rs","swift","m","mm","dart","lua","pl","pm","r","rmd",
  "zig","nim","v","d","ada","adb","ads","f90","f95","f03","f08",
  "hs","lhs","ml","mli","ocaml","ex","exs","erl","hrl","clj","cljs","lisp","el","scm","rkt",
  "vb","vbs","bas","asm","s","wasm","wat",
  // Web
  "html","htm","xhtml","css","scss","sass","less","styl",
  "vue","svelte","astro","jsx","tsx","ejs","hbs","pug","jade",
  // 数据/配置
  "json","jsonl","json5","yaml","yml","toml","ini","cfg","conf","env","properties",
  "xml","xsl","xsd","dtd","svg","plist","graphql","gql","proto","protobuf",
  // Shell/脚本
  "sh","bash","zsh","fish","ps1","psm1","bat","cmd","vbs",
  // 数据库
  "sql","sqlite","prisma","graphql",
  // 标记/文档
  "tex","latex","bib","csv","tsv","org","wiki","adoc","asciidoc",
  // DevOps/Config
  "dockerfile","vagrantfile","makefile","cmake","gradle","sbt","gemfile","podfile",
  "gitignore","gitattributes","editorconfig","eslintrc","prettierrc","babelrc",
  "npmignore","dockerignore","htaccess","nginx",
  // 其他
  "diff","patch","lock","sum","mod","csproj","sln","xcodeproj","pbxproj",
  "ipynb","rmd","qmd","typ","mdx"
]);

// 二进制文档类型 → 只有 PDF 用 document block，其他提取文字
const DOC_EXTENSIONS = {
  "pdf": "application/pdf",
  "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "doc": "application/msword",
  "xls": "application/vnd.ms-excel",
  "ppt": "application/vnd.ms-powerpoint",
  "odt": "application/vnd.oasis.opendocument.text",
  "ods": "application/vnd.oasis.opendocument.spreadsheet",
  "odp": "application/vnd.oasis.opendocument.presentation",
  "epub": "application/epub+zip",
  "pages": "application/x-iwork-pages-sffpages",
  "numbers": "application/x-iwork-numbers-sffnumbers",
  "key": "application/x-iwork-keynote-sffkey"
};

// Dynamically load mammoth.js for docx text extraction
let mammothLoaded = false;
function loadMammoth() {
  if (mammothLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";
    script.onload = () => { mammothLoaded = true; resolve(); };
    script.onerror = () => reject(new Error("无法加载 docx 解析库"));
    document.head.appendChild(script);
  });
}

// Extract text from docx using mammoth.js
// Sanitize text: remove unpaired Unicode surrogates and control chars that break JSON
function sanitizeText(text) {
  if (!text) return text;
  // Remove unpaired surrogates
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
             .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
             .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

async function extractDocxText(file) {
  await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return sanitizeText(result.value);
}

// Extract text from xlsx/pptx by reading XML from zip
async function extractOfficeXmlText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  // Use JSZip-like approach with native APIs — try to decompress and parse XML
  // Fallback: read raw bytes and extract readable text
  try {
    const bytes = new Uint8Array(arrayBuffer);
    // Find XML content between tags — office formats are ZIP archives with XML
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const raw = decoder.decode(bytes);
    // Extract text between XML tags
    const textParts = [];
    const tagRegex = />([^<]{2,})</g;
    let m;
    while ((m = tagRegex.exec(raw)) !== null) {
      const t = m[1].trim();
      if (t && !/^[\x00-\x1f\s]+$/.test(t) && !/^[A-Za-z0-9+/=\s]{50,}$/.test(t)) {
        textParts.push(t);
      }
    }
    if (textParts.length > 10) return sanitizeText(textParts.join("\n"));
  } catch(e) {}
  throw new Error("无法提取文件文字内容");
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";

  const ext = file.name.split(".").pop().toLowerCase();
  const maxSize = 10 * 1024 * 1024; // 10MB limit

  const sizeValidation = InputValidator.validateFileSize(file.size);
  if (!sizeValidation.valid) {
    alert(sizeValidation.message);
    return;
  }

  try {
    if (DOC_EXTENSIONS[ext]) {
      if (ext === "pdf") {
        // PDF → send as base64 document block to MiMo API
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        pendingFile = { name: file.name, type: ext, isDoc: true, isPdf: true, base64, mediaType: "application/pdf", content: null };
      } else if (ext === "docx") {
        // DOCX → extract text using mammoth.js then send as text
        try {
          const content = await extractDocxText(file);
          if (!content || content.trim().length === 0) throw new Error("文件内容为空");
          const lengthValidation = InputValidator.validateMessageLength(content, 80000);
          if (!lengthValidation.valid) {
            alert(lengthValidation.message);
            return;
          }
          pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content };
        } catch(e) {
          alert("读取 .docx 文件失败: " + e.message);
          return;
        }
      } else {
        // Other office formats → try extracting text from XML in zip
        try {
          const content = await extractOfficeXmlText(file);
          const lengthValidation = InputValidator.validateMessageLength(content, 80000);
          if (!lengthValidation.valid) {
            alert(lengthValidation.message);
            return;
          }
          pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content };
        } catch(e) {
          alert("暂时只支持 PDF 和 DOCX 文件的直接读取。\n请将文件转为 PDF 或复制文字内容发送。");
          return;
        }
      }
    } else if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/") || ext === "") {
      // Text file → read as text
      const content = await file.text();
      const lengthValidation = InputValidator.validateMessageLength(content, 80000);
      if (!lengthValidation.valid) {
        alert(lengthValidation.message);
        return;
      }
      pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content };
    } else if (file.type.startsWith("image/")) {
      // Image → redirect to image handler
      processImageFile(file);
      return;
    } else {
      // Unknown → try reading as text
      try {
        const content = await file.text();
        if (content.includes("\\x00") || content.length === 0) throw new Error("binary");
        pendingFile = { name: file.name, type: ext, isDoc: false, isPdf: false, base64: null, content: content.slice(0, 40000) };
      } catch(e) {
        // Binary file that can't be read as text — inform user
        alert("无法读取此文件。请转为 PDF、DOCX 或文本格式后重试。");
        return;
      }
    }

    document.getElementById("filePreviewBar").style.display = "flex";
    document.getElementById("filePreviewName").textContent = file.name + " (" + (file.size > 1024 ? Math.round(file.size/1024) + "KB" : file.size + "B") + ")";
    document.getElementById("chatInput").placeholder = "可以说说你想让【角色称呼代词】看什么...";
  } catch(e) {
    alert("读取文件失败: " + e.message);
  }
}

function clearFilePreview() {
  pendingFile = null;
  document.getElementById("filePreviewBar").style.display = "none";
  document.getElementById("chatInput").placeholder = "跟我说话...";
}

function createFileDownload(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return { url, filename };
}

// Dynamic script loader (reusable)
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function createPdfFile(filename, textContent) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");

  const title = filename.replace(/\.pdf$/i, "");
  let html = `<div style="font-family:'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif;font-size:13pt;line-height:2;color:#222;padding:0;">`;
  html += `<h1 style="font-size:20pt;text-align:center;margin:0 0 20px;font-weight:700">${escapeHtml(title)}</h1>`;
  const lines = textContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { html += `<br/>`; continue; }
    if (trimmed.startsWith("#")) {
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.replace(/^#+\s*/, "");
      const sizes = {1:"18pt",2:"16pt",3:"14pt"};
      html += `<p style="font-size:${sizes[level]||"13pt"};font-weight:700;margin:16px 0 8px">${escapeHtml(text)}</p>`;
    } else {
      html += `<p style="margin:4px 0;text-indent:2em">${escapeHtml(trimmed)}</p>`;
    }
  }
  html += `</div>`;

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:520px;background:#fff;padding:0;";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageW = pdf.internal.pageSize.getWidth() - 20; // 10mm margins
    const pageH = pdf.internal.pageSize.getHeight() - 20;
    const imgW = canvas.width;
    const imgH = canvas.height;
    const ratio = pageW / (imgW / 2);
    const scaledH = (imgH / 2) * ratio;

    let y = 0;
    let page = 0;
    while (y < scaledH) {
      if (page > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 10, 10 - y, pageW, scaledH);
      y += pageH;
      page++;
    }

    const blob = pdf.output("blob");
    return URL.createObjectURL(blob);
  } finally {
    document.body.removeChild(container);
  }
}

async function appendImageMessage(text, dataUrl, save, time) {
  const ts = time || Date.now();
  const area = document.getElementById("chatArea");
  const row = document.createElement("div");
  row.className = "msg-row user";
  const textHtml = text ? `<div style="margin-top:6px">${escapeHtml(text)}</div>` : "";
  row.innerHTML = `
    <div class="bubble user">
      <img class="user-img-msg" src="${dataUrl}" onclick="window.open(this.src,'_blank')" />
      ${textHtml}
    </div>
    <div class="msg-time">${formatMsgTime(ts)}</div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;

  if (save) {
    const imgId = "img_" + Date.now();
    const blob = await fetch(dataUrl).then(r => r.blob());
    await AudioDB.save(imgId, blob);
    chatMessages.push({ role: "user", text: text || "[图片]", isImage: true, imgId, time: ts });
    saveChatHistory(); // triggers memory library sync
  }
}

async function appendImageFromDB(imgId, text) {
  const blob = await AudioDB.load(imgId);
  if (blob) {
    const url = URL.createObjectURL(blob);
    await appendImageMessage(text, url, false);
  } else {
    appendMessage("user", text || "[图片已过期]", false);
  }
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
