// ============================================================
// === Period Calendar — 经期日历系统 ===
// ============================================================
let periodData = {
  cycles: [],          // [{startDate:"2025-06-01", endDate:"2025-06-05"}]
  dailyLogs: {},       // { "2025-06-20": {mood,symptoms[],waterCups,sleep,exercise:{type,duration},skincare[],medications[]} }
  settings: { cycleLength: 28, periodLength: 5 },
  medicationReminders: [] // [{id, name, timeStr, enabled}]
};
let periodDataLoaded = false;
let periodCalMonth = null; // {year, month}
let medReminderTimers = {}; // id -> timerId

function togglePeriodPanel() {
  document.getElementById("periodPanel").classList.toggle("open");
  document.getElementById("periodOverlay").classList.toggle("open");
  if (document.getElementById("periodPanel").classList.contains("open")) {
    if (!periodCalMonth) { const n = new Date(); periodCalMonth = {year: n.getFullYear(), month: n.getMonth()}; }
    switchPeriodTab("calendar");
  }
}

function switchPeriodTab(tab) {
  document.querySelectorAll(".period-tab").forEach((t, i) => {
    t.classList.toggle("active", ["calendar","records","meds","settings"][i] === tab);
  });
  if (tab === "calendar") renderPeriodCalendar();
  else if (tab === "records") renderPeriodRecords();
  else if (tab === "meds") renderMedsTab();
  else if (tab === "settings") renderPeriodSettings();
}

// --- Cycle helpers ---
function getPeriodDays() {
  const days = new Set();
  for (const c of periodData.cycles) {
    const s = new Date(c.startDate + "T00:00:00");
    const e = c.endDate ? new Date(c.endDate + "T00:00:00") : null;
    const end = e || new Date(s.getTime() + (periodData.settings.periodLength - 1) * 86400000);
    for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) {
      days.add(fmtD(d));
    }
  }
  return days;
}

function fmtD(d) {
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function getLastCycle() {
  if (periodData.cycles.length === 0) return null;
  return [...periodData.cycles].sort((a,b) => b.startDate.localeCompare(a.startDate))[0];
}

function getAverageCycleLength() {
  if (periodData.cycles.length < 2) return periodData.settings.cycleLength;
  const sorted = [...periodData.cycles].sort((a,b) => a.startDate.localeCompare(b.startDate));
  let total = 0, count = 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (new Date(sorted[i].startDate) - new Date(sorted[i-1].startDate)) / 86400000;
    if (diff > 15 && diff < 60) { total += diff; count++; }
  }
  return count > 0 ? Math.round(total / count) : periodData.settings.cycleLength;
}

function getNextPeriodDate() {
  const last = getLastCycle();
  if (!last) return null;
  const cycleLen = getAverageCycleLength();
  const start = new Date(last.startDate + "T00:00:00");
  return new Date(start.getTime() + cycleLen * 86400000);
}

function isCurrentlyOnPeriod() {
  const last = getLastCycle();
  if (!last) return false;
  if (last.endDate) return false; // ended
  const start = new Date(last.startDate + "T00:00:00");
  const daysSince = Math.floor((Date.now() - start.getTime()) / 86400000);
  return daysSince < periodData.settings.periodLength + 5; // allow some buffer
}

function getCyclePhase(dateStr) {
  const last = getLastCycle();
  if (!last) return null;
  const cycleLen = getAverageCycleLength();
  const pLen = periodData.settings.periodLength;
  const start = new Date(last.startDate + "T00:00:00");
  const target = new Date(dateStr + "T00:00:00");
  let dayInCycle = Math.floor((target - start) / 86400000) % cycleLen;
  if (dayInCycle < 0) dayInCycle += cycleLen;
  if (dayInCycle < pLen) return { phase: "menstrual", day: dayInCycle + 1, label: "经期" };
  if (dayInCycle < 13) return { phase: "follicular", day: dayInCycle + 1, label: "卵泡期" };
  if (dayInCycle < 16) return { phase: "ovulation", day: dayInCycle + 1, label: "排卵期" };
  return { phase: "luteal", day: dayInCycle + 1, label: "黄体期" };
}

function getSkincareTip(phase) {
  const tips = {
    menstrual: "🧴 经期护肤：皮肤较敏感，建议温和清洁+强效保湿，避免刺激性产品和去角质",
    follicular: "✨ 卵泡期护肤：雌激素上升，皮肤状态好！适合深层清洁、去角质、尝试新产品",
    ovulation: "🌟 排卵期护肤：皮肤状态巅峰，适合做面膜、美白精华，注意控油",
    luteal: "💧 黄体期护肤：皮肤易出油长痘，重点保湿+抗痘，避免高糖饮食"
  };
  return tips[phase] || "";
}

function getExerciseTip(phase) {
  const tips = {
    menstrual: "🧘 经期运动建议：轻柔瑜伽、散步为主，避免高强度运动，注意保暖",
    follicular: "🏃 卵泡期运动：精力充沛！可以增加运动强度，尝试跑步、力量训练",
    ovulation: "💪 排卵期运动：体能巅峰期，适合高强度训练、HIIT、竞技运动",
    luteal: "🚶 黄体期运动：逐渐降低强度，以散步、拉伸、低强度有氧为主"
  };
  return tips[phase] || "";
}

// --- Calendar Rendering ---
function renderPeriodCalendar() {
  const body = document.getElementById("periodPanelBody");
  const y = periodCalMonth.year, m = periodCalMonth.month;
  const today = fmtD(new Date());
  const periodDays = getPeriodDays();
  const nextPeriod = getNextPeriodDate();
  const onPeriod = isCurrentlyOnPeriod();
  const currentPhase = getCyclePhase(today);

  // Predicted period days
  const predictedDays = new Set();
  if (nextPeriod) {
    for (let i = 0; i < periodData.settings.periodLength; i++) {
      const d = new Date(nextPeriod.getTime() + i * 86400000);
      const ds = fmtD(d);
      if (!periodDays.has(ds)) predictedDays.add(ds);
    }
  }

  // Countdown
  let countdownHtml = "";
  if (onPeriod) {
    const last = getLastCycle();
    const daysSince = Math.floor((Date.now() - new Date(last.startDate + "T00:00:00").getTime()) / 86400000) + 1;
    countdownHtml = `<div class="period-countdown-card on-period">
      <div class="countdown-num">第 ${daysSince} 天</div>
      <div class="countdown-label">经期进行中 · 注意保暖多休息 💕</div>
      <div class="period-action-btns"><button class="end-btn" onclick="markPeriodEnd()">✓ 今天结束了</button></div>
    </div>`;
  } else if (nextPeriod) {
    const daysUntil = Math.ceil((nextPeriod - Date.now()) / 86400000);
    if (daysUntil <= 0) {
      countdownHtml = `<div class="period-countdown-card warning">
        <div class="countdown-num">预计今天</div>
        <div class="countdown-label">经期可能要来了，注意身体变化 🩸</div>
        <div class="period-action-btns"><button class="primary" onclick="markPeriodStart()">🩸 今天来了</button></div>
      </div>`;
    } else if (daysUntil <= 3) {
      countdownHtml = `<div class="period-countdown-card warning">
        <div class="countdown-num">还有 ${daysUntil} 天</div>
        <div class="countdown-label">⚠️ 经期快来了，记得备好姨妈巾哦！</div>
        <div class="period-action-btns"><button class="primary" onclick="markPeriodStart()">🩸 提前来了</button></div>
      </div>`;
    } else {
      countdownHtml = `<div class="period-countdown-card">
        <div class="countdown-num">还有 ${daysUntil} 天</div>
        <div class="countdown-label">${currentPhase ? currentPhase.label + " · 第" + currentPhase.day + "天" : "距离下次经期"}</div>
        <div class="period-action-btns"><button class="primary" onclick="markPeriodStart()">🩸 今天来了</button></div>
      </div>`;
    }
  } else {
    countdownHtml = `<div class="period-countdown-card">
      <div class="countdown-num">📅</div>
      <div class="countdown-label">还没有记录，点下面按钮开始记录吧</div>
      <div class="period-action-btns"><button class="primary" onclick="markPeriodStart()">🩸 今天来了</button></div>
    </div>`;
  }

  // Phase tips
  let phaseTip = "";
  if (currentPhase) {
    phaseTip = `<div class="pd-skincare-tip" style="margin-bottom:12px">${getSkincareTip(currentPhase.phase)}<br><br>${getExerciseTip(currentPhase.phase)}</div>`;
  }

  // Build calendar grid
  const firstDay = new Date(y, m, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];

  let gridHtml = '<div class="period-cal-grid">';
  const weekHeaders = ["日","一","二","三","四","五","六"];
  for (const wh of weekHeaders) gridHtml += `<div class="period-cal-header">${wh}</div>`;

  // Previous month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevDays - i;
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    const ds = fmtD(new Date(py, pm, d));
    gridHtml += `<div class="period-cal-day other-month" onclick="openPeriodDay('${ds}')" title="${ds}"><span class="cal-day-num">${d}</span></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = fmtD(new Date(y, m, d));
    let cls = "period-cal-day";
    if (ds === today) cls += " today";
    if (periodDays.has(ds)) cls += " period";
    else if (predictedDays.has(ds)) cls += " predicted";
    else {
      const ph = getCyclePhase(ds);
      if (ph && ph.phase === "ovulation") cls += " ovulation";
      else if (ph && ph.phase === "follicular") cls += " fertile";
    }
    const hasLog = periodData.dailyLogs[ds];
    const dotHtml = hasLog ? '<span class="cal-day-dot has-log"></span>' : '<span class="cal-day-dot"></span>';
    gridHtml += `<div class="${cls}" onclick="openPeriodDay('${ds}')" title="${ds}"><span class="cal-day-num">${d}</span>${dotHtml}</div>`;
  }

  // Next month padding
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let d = 1; d <= remaining; d++) {
    const nm = m === 11 ? 0 : m + 1;
    const ny = m === 11 ? y + 1 : y;
    const ds = fmtD(new Date(ny, nm, d));
    gridHtml += `<div class="period-cal-day other-month" onclick="openPeriodDay('${ds}')" title="${ds}"><span class="cal-day-num">${d}</span></div>`;
  }
  gridHtml += '</div>';

  body.innerHTML = `${countdownHtml}
    <div class="period-cal-nav">
      <button onclick="periodCalPrev()">◂</button>
      <span class="cal-month-label">${y}年${monthNames[m]}</span>
      <button onclick="periodCalNext()">▸</button>
    </div>
    ${gridHtml}
    <div class="period-cal-legend">
      <span><span class="legend-dot" style="background:#e06060"></span>经期</span>
      <span><span class="legend-dot" style="background:rgba(220,80,80,0.3);border:1px dashed #e06060"></span>预测</span>
      <span><span class="legend-dot" style="background:rgba(100,180,220,0.4)"></span>排卵</span>
      <span><span class="legend-dot" style="background:var(--accent)"></span>有记录</span>
    </div>
    ${phaseTip}`;
}

function periodCalPrev() { periodCalMonth.month--; if (periodCalMonth.month < 0) { periodCalMonth.month = 11; periodCalMonth.year--; } renderPeriodCalendar(); }
function periodCalNext() { periodCalMonth.month++; if (periodCalMonth.month > 11) { periodCalMonth.month = 0; periodCalMonth.year++; } renderPeriodCalendar(); }

// --- Mark period start/end ---
function markPeriodStart() {
  const todayStr = fmtD(new Date());
  if (isCurrentlyOnPeriod()) { showToast("已经在经期中了哦"); return; }
  periodData.cycles.push({ startDate: todayStr, endDate: null });
  savePeriodData();
  renderPeriodCalendar();
  showToast("🩸 已标记经期开始");
}

function markPeriodEnd() {
  const last = getLastCycle();
  if (!last || last.endDate) { showToast("没有进行中的经期"); return; }
  last.endDate = fmtD(new Date());
  savePeriodData();
  renderPeriodCalendar();
  showToast("✓ 经期已结束，辛苦了 💕");
}

// --- Day detail modal ---
function openPeriodDay(dateStr) {
  const log = periodData.dailyLogs[dateStr] || {};
  const phase = getCyclePhase(dateStr);
  const periodDays = getPeriodDays();
  const isPeriodDay = periodDays.has(dateStr);

  const [y,m,d] = dateStr.split("-");
  const dateLabel = `${parseInt(m)}月${parseInt(d)}日`;
  const phaseLabel = phase ? `（${phase.label}·第${phase.day}天）` : "";

  const moods = ["😊 开心","😐 平静","😢 低落","😡 烦躁","😰 焦虑","😴 疲惫"];
  const symptoms = ["腹痛","腰酸","头痛","胸胀","浮肿","痘痘","食欲大增","恶心","情绪波动"];
  const sleepOpts = ["早睡","正常","晚睡","失眠"];
  const exerciseTypes = ["瑜伽","跑步","散步","力量训练","游泳","骑车","跳舞","其他"];
  const skincareOpts = ["洁面","面膜","精华","防晒","去角质","保湿"];

  let moodsHtml = moods.map(mo => {
    const v = mo.split(" ")[1];
    return `<span class="pd-opt${log.mood === v ? ' selected' : ''}" data-field="mood" data-val="${v}" onclick="pdToggle(this)">${mo}</span>`;
  }).join("");

  let symptomsHtml = symptoms.map(s =>
    `<span class="pd-opt${(log.symptoms||[]).includes(s) ? ' selected' : ''}" data-field="symptoms" data-val="${s}" onclick="pdToggleMulti(this)">${s}</span>`
  ).join("");

  let sleepHtml = sleepOpts.map(s =>
    `<span class="pd-opt${log.sleep === s ? ' selected' : ''}" data-field="sleep" data-val="${s}" onclick="pdToggle(this)">${s}</span>`
  ).join("");

  let exerciseHtml = exerciseTypes.map(t =>
    `<span class="pd-opt${log.exerciseType === t ? ' selected' : ''}" data-field="exerciseType" data-val="${t}" onclick="pdToggle(this)">${t}</span>`
  ).join("");

  let skincareHtml = skincareOpts.map(s =>
    `<span class="pd-opt${(log.skincare||[]).includes(s) ? ' selected' : ''}" data-field="skincare" data-val="${s}" onclick="pdToggleMulti(this)">${s}</span>`
  ).join("");

  let medListHtml = "";
  if (log.medications && log.medications.length > 0) {
    medListHtml = `<div class="pd-med-list">${log.medications.map((med, i) =>
      `<div class="pd-med-item"><span>💊 ${escapeHtml(med)}</span><button onclick="pdRemoveMed(${i})">✕</button></div>`
    ).join("")}</div>`;
  }

  const skinTip = phase ? `<div class="pd-skincare-tip">${getSkincareTip(phase.phase)}</div>` : "";

  document.getElementById("periodDayContent").innerHTML = `
    <h4>${dateLabel} ${phaseLabel}${isPeriodDay ? ' 🩸' : ''}<button onclick="closePeriodDayModal()">✕</button></h4>
    <div class="pd-section"><div class="pd-section-title">😊 心情</div><div class="pd-options" id="pdMoodOpts">${moodsHtml}</div></div>
    <div class="pd-section"><div class="pd-section-title">🩹 症状</div><div class="pd-options" id="pdSymptomOpts">${symptomsHtml}</div></div>
    <div class="pd-section"><div class="pd-section-title">💤 睡眠质量</div><div class="pd-options" id="pdSleepOpts">${sleepHtml}</div></div>
    <div class="pd-section"><div class="pd-section-title">💧 喝水（杯）</div>
      <div class="pd-water-row"><button onclick="pdWaterAdj(-1)">−</button><span id="pdWaterCount">${log.waterCups || 0}</span><button onclick="pdWaterAdj(1)">+</button></div>
    </div>
    <div class="pd-section"><div class="pd-section-title">🏃 运动</div><div class="pd-options" id="pdExerciseOpts">${exerciseHtml}</div>
      <div class="pd-exercise-row"><span style="font-size:11px;color:var(--text-dim)">时长</span><input id="pdExDuration" type="number" min="0" value="${log.exerciseDuration || 0}" placeholder="分钟"/><span style="font-size:11px;color:var(--text-dim)">分钟</span></div>
    </div>
    <div class="pd-section"><div class="pd-section-title">🧴 护肤打卡</div><div class="pd-options" id="pdSkincareOpts">${skincareHtml}</div>${skinTip}</div>
    <div class="pd-section"><div class="pd-section-title">💊 今日用药</div>
      <div class="pd-med-row"><input id="pdMedInput" placeholder="药名" /><button onclick="pdAddMed()">+</button></div>
      ${medListHtml}
    </div>
    <button class="pd-save-btn" onclick="pdSaveDay('${dateStr}')">保存记录</button>`;
  document.getElementById("periodDayModal").classList.add("open");
  // Store current editing date
  document.getElementById("periodDayModal").dataset.date = dateStr;
}

function closePeriodDayModal() {
  document.getElementById("periodDayModal").classList.remove("open");
}

// --- Day modal interactions ---
function pdToggle(el) {
  const field = el.dataset.field;
  const container = el.closest(".pd-options");
  container.querySelectorAll(`[data-field="${field}"]`).forEach(e => e.classList.remove("selected"));
  el.classList.add("selected");
}
function pdToggleMulti(el) { el.classList.toggle("selected"); }
function pdWaterAdj(delta) {
  const el = document.getElementById("pdWaterCount");
  let v = parseInt(el.textContent) + delta;
  if (v < 0) v = 0; if (v > 20) v = 20;
  el.textContent = v;
}
function pdAddMed() {
  const inp = document.getElementById("pdMedInput");
  const name = inp.value.trim();
  if (!name) return;
  const dateStr = document.getElementById("periodDayModal").dataset.date;
  if (!periodData.dailyLogs[dateStr]) periodData.dailyLogs[dateStr] = {};
  if (!periodData.dailyLogs[dateStr].medications) periodData.dailyLogs[dateStr].medications = [];
  periodData.dailyLogs[dateStr].medications.push(name);
  inp.value = "";
  openPeriodDay(dateStr); // re-render
}
function pdRemoveMed(idx) {
  const dateStr = document.getElementById("periodDayModal").dataset.date;
  const log = periodData.dailyLogs[dateStr];
  if (log && log.medications) { log.medications.splice(idx, 1); openPeriodDay(dateStr); }
}

function pdSaveDay(dateStr) {
  const log = periodData.dailyLogs[dateStr] || {};
  // Mood
  const moodEl = document.querySelector("#pdMoodOpts .pd-opt.selected");
  log.mood = moodEl ? moodEl.dataset.val : log.mood;
  // Symptoms
  log.symptoms = Array.from(document.querySelectorAll("#pdSymptomOpts .pd-opt.selected")).map(e => e.dataset.val);
  // Sleep
  const sleepEl = document.querySelector("#pdSleepOpts .pd-opt.selected");
  log.sleep = sleepEl ? sleepEl.dataset.val : log.sleep;
  // Water
  log.waterCups = parseInt(document.getElementById("pdWaterCount").textContent) || 0;
  // Exercise
  const exEl = document.querySelector("#pdExerciseOpts .pd-opt.selected");
  log.exerciseType = exEl ? exEl.dataset.val : log.exerciseType;
  log.exerciseDuration = parseInt(document.getElementById("pdExDuration").value) || 0;
  // Skincare
  log.skincare = Array.from(document.querySelectorAll("#pdSkincareOpts .pd-opt.selected")).map(e => e.dataset.val);
  // Meds are already saved via pdAddMed

  periodData.dailyLogs[dateStr] = log;
  savePeriodData();
  closePeriodDayModal();
  renderPeriodCalendar();
  showToast("✓ 记录已保存");
}

// --- Records tab ---
function renderPeriodRecords() {
  const body = document.getElementById("periodPanelBody");
  const avgCycle = getAverageCycleLength();
  const sorted = [...periodData.cycles].sort((a,b) => b.startDate.localeCompare(a.startDate));
  const totalCycles = sorted.length;

  // Average period length
  let avgPeriod = periodData.settings.periodLength;
  const completeCycles = sorted.filter(c => c.endDate);
  if (completeCycles.length > 0) {
    const totalP = completeCycles.reduce((sum, c) => {
      return sum + Math.ceil((new Date(c.endDate) - new Date(c.startDate)) / 86400000) + 1;
    }, 0);
    avgPeriod = Math.round(totalP / completeCycles.length);
  }

  // Recent daily logs summary
  const today = new Date();
  const last7 = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    const ds = fmtD(d);
    const log = periodData.dailyLogs[ds];
    if (log && (log.mood || (log.symptoms && log.symptoms.length) || log.waterCups || log.sleep)) {
      const [,mo,da] = ds.split("-");
      last7.push(`<div class="period-history-item">
        <span class="ph-dot" style="background:var(--accent)"></span>
        <span class="ph-date">${parseInt(mo)}/${parseInt(da)}</span>
        <span>${log.mood || ""} ${(log.symptoms||[]).join("·")} 💧${log.waterCups||0} ${log.sleep ? "💤"+log.sleep : ""} ${log.exerciseType ? "🏃"+log.exerciseType+(log.exerciseDuration?"("+log.exerciseDuration+"min)":"") : ""}</span>
      </div>`);
    }
  }

  let historyHtml = sorted.slice(0, 12).map(c => {
    const [,sm,sd] = c.startDate.split("-");
    const endLabel = c.endDate ? c.endDate.split("-").slice(1).map(x=>parseInt(x)).join("/") : "进行中";
    const len = c.endDate ? Math.ceil((new Date(c.endDate) - new Date(c.startDate)) / 86400000) + 1 : "-";
    return `<div class="period-history-item"><span class="ph-dot"></span><span class="ph-date">${parseInt(sm)}/${parseInt(sd)}</span><span>${endLabel} · ${len}天</span></div>`;
  }).join("");

  body.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <div class="period-stat-card" style="flex:1"><div class="stat-title">平均周期</div><div class="stat-value">${avgCycle}天</div></div>
      <div class="period-stat-card" style="flex:1"><div class="stat-title">平均经期</div><div class="stat-value">${avgPeriod}天</div></div>
      <div class="period-stat-card" style="flex:1"><div class="stat-title">已记录</div><div class="stat-value">${totalCycles}次</div></div>
    </div>
    ${last7.length > 0 ? `<div class="period-stat-card"><div class="stat-title">📋 近7天打卡</div>${last7.join("")}</div>` : ""}
    <div class="period-stat-card"><div class="stat-title">📅 经期历史</div>${historyHtml || '<div style="padding:10px;color:var(--text-dim);font-size:12px">还没有记录</div>'}</div>`;
}

// --- Medication Reminders tab ---
function renderMedsTab() {
  const body = document.getElementById("periodPanelBody");
  let remindersHtml = periodData.medicationReminders.map((r, i) => {
    const cdHtml = r.enabled ? `<div class="med-countdown" id="medCd_${r.id}"></div>` : '<div style="font-size:11px;color:var(--text-dim)">已暂停</div>';
    return `<div class="med-reminder-card">
      <div class="med-icon">💊</div>
      <div class="med-info"><div class="med-name">${escapeHtml(r.name)}</div><div class="med-time">⏰ 每天 ${r.timeStr}</div>${cdHtml}</div>
      <div class="med-reminder-actions">
        <button onclick="toggleMedReminder(${i})">${r.enabled ? '⏸' : '▶'}</button>
        <button onclick="removeMedReminder(${i})">✕</button>
      </div>
    </div>`;
  }).join("");

  body.innerHTML = `
    <div class="med-add-form">
      <label>药品名称</label><input id="medRName" placeholder="如：布洛芬" />
      <label>提醒时间</label><input id="medRTime" type="time" value="08:00" />
      <button class="pd-save-btn" onclick="addMedReminder()">添加用药提醒</button>
    </div>
    ${remindersHtml || '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px">还没有设置用药提醒</div>'}`;
  // Update countdowns
  setTimeout(updateMedCountdowns, 100);
}

function addMedReminder() {
  const name = document.getElementById("medRName").value.trim();
  const time = document.getElementById("medRTime").value;
  if (!name) { showToast("请输入药品名称"); return; }
  const id = "med_" + Date.now();
  periodData.medicationReminders.push({ id, name, timeStr: time, enabled: true });
  savePeriodData();
  startMedReminderTimer({ id, name, timeStr: time, enabled: true });
  renderMedsTab();
  showToast("✓ 提醒已添加");
}

function toggleMedReminder(idx) {
  const r = periodData.medicationReminders[idx];
  r.enabled = !r.enabled;
  if (!r.enabled && medReminderTimers[r.id]) { clearTimeout(medReminderTimers[r.id]); delete medReminderTimers[r.id]; }
  else if (r.enabled) startMedReminderTimer(r);
  savePeriodData();
  renderMedsTab();
}

function removeMedReminder(idx) {
  const r = periodData.medicationReminders[idx];
  if (medReminderTimers[r.id]) { clearTimeout(medReminderTimers[r.id]); delete medReminderTimers[r.id]; }
  periodData.medicationReminders.splice(idx, 1);
  savePeriodData();
  renderMedsTab();
}

function startMedReminderTimer(r) {
  if (!r.enabled) return;
  const [hh, mm] = r.timeStr.split(":").map(Number);
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const ms = target - now;
  if (medReminderTimers[r.id]) clearTimeout(medReminderTimers[r.id]);
  medReminderTimers[r.id] = setTimeout(() => {
    // Fire notification
    try {
      if (Notification.permission === "granted") {
        new Notification("💊 吃药提醒", { body: `该吃 ${r.name} 了！`, icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>💊</text></svg>" });
      }
    } catch(e) {}
    showToast(`💊 该吃 ${r.name} 了！`);
    // Reschedule for next day
    startMedReminderTimer(r);
  }, ms);
}

function updateMedCountdowns() {
  const now = new Date();
  for (const r of periodData.medicationReminders) {
    if (!r.enabled) continue;
    const el = document.getElementById("medCd_" + r.id);
    if (!el) continue;
    const [hh, mm] = r.timeStr.split(":").map(Number);
    let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const diff = Math.floor((target - now) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    el.textContent = `⏳ ${h}小时${m}分钟后提醒`;
  }
}
// Update countdowns every minute
setInterval(() => { if (document.getElementById("periodPanel")?.classList.contains("open")) updateMedCountdowns(); }, 60000);

// --- Settings tab ---
function renderPeriodSettings() {
  const body = document.getElementById("periodPanelBody");
  body.innerHTML = `
    <div class="period-stat-card">
      <div class="stat-title">⚙️ 周期设置</div>
      <div style="margin-top:10px">
        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">默认周期长度（天）</label>
        <input id="psCycleLen" type="number" min="20" max="45" value="${periodData.settings.cycleLength}"
          style="width:80px;padding:6px 10px;font-size:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);outline:none" />
      </div>
      <div style="margin-top:10px">
        <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">默认经期天数</label>
        <input id="psPeriodLen" type="number" min="2" max="10" value="${periodData.settings.periodLength}"
          style="width:80px;padding:6px 10px;font-size:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary);color:var(--text-primary);outline:none" />
      </div>
      <button class="pd-save-btn" style="margin-top:14px" onclick="savePeriodSettings()">保存设置</button>
    </div>
    <div class="period-stat-card">
      <div class="stat-title">🗑️ 数据管理</div>
      <div style="margin-top:10px">
        <button class="pd-save-btn" style="background:var(--error);margin-top:0" onclick="clearPeriodData()">清空所有经期数据</button>
      </div>
    </div>`;
}

function savePeriodSettings() {
  periodData.settings.cycleLength = parseInt(document.getElementById("psCycleLen").value) || 28;
  periodData.settings.periodLength = parseInt(document.getElementById("psPeriodLen").value) || 5;
  savePeriodData();
  showToast("✓ 设置已保存");
}

function clearPeriodData() {
  if (!confirm("确定要清空所有经期数据吗？此操作不可撤销。")) return;
  periodData.cycles = [];
  periodData.dailyLogs = {};
  periodData.medicationReminders = [];
  savePeriodData();
  switchPeriodTab("calendar");
  showToast("已清空");
}

// --- Save/Load period data to memory library ---
async function savePeriodData() {
  // Always save to localStorage as fallback
  try { localStorage.setItem("vbc_period_data", JSON.stringify(periodData)); } catch(e) {}
  // Save to memory library
  if (!memoryEnabled || !memoryDirHandle) return;
  try {
    const perm = await memoryDirHandle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    const fh = await memoryDirHandle.getFileHandle("period-data.json", { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(periodData));
    await w.close();
    console.log("[Period] Saved period data");
  } catch(e) { console.warn("[Period] Save error:", e); }
}

async function loadPeriodDataFromMemory() {
  // Try memory library first
  if (memoryEnabled && memoryDirHandle) {
    try {
      const perm = await memoryDirHandle.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        const fh = await memoryDirHandle.getFileHandle("period-data.json");
        const f = await fh.getFile();
        const data = JSON.parse(await f.text());
        if (data.cycles) periodData.cycles = data.cycles;
        if (data.dailyLogs) periodData.dailyLogs = data.dailyLogs;
        if (data.settings) periodData.settings = { ...periodData.settings, ...data.settings };
        if (data.medicationReminders) periodData.medicationReminders = data.medicationReminders;
        periodDataLoaded = true;
        console.log("[Period] Loaded from memory library:", periodData.cycles.length, "cycles");
        // Start medication reminders
        for (const r of periodData.medicationReminders) { if (r.enabled) startMedReminderTimer(r); }
        return;
      }
    } catch(e) { /* file doesn't exist yet */ }
  }
  // Fallback to localStorage
  try {
    const saved = localStorage.getItem("vbc_period_data");
    if (saved) {
      const data = JSON.parse(saved);
      if (data.cycles) periodData.cycles = data.cycles;
      if (data.dailyLogs) periodData.dailyLogs = data.dailyLogs;
      if (data.settings) periodData.settings = { ...periodData.settings, ...data.settings };
      if (data.medicationReminders) periodData.medicationReminders = data.medicationReminders;
      for (const r of periodData.medicationReminders) { if (r.enabled) startMedReminderTimer(r); }
    }
  } catch(e) {}
  periodDataLoaded = true;
}

// --- Bot integration: period context for system prompt ---
function shouldReadPeriodContext(text) {
  const keywords = [
    "月经","大姨妈","姨妈","经期","例假","生理期","来事","那个来了","那个快来",
    "肚子疼","肚子痛","肚子好疼","肚子很疼","肚子超疼","痛经","姨妈痛","小腹疼","小腹痛","暖宝宝","红糖水","热水袋",
    "排卵","安全期","周期","黄体期","卵泡期",
    "不舒服","身体不舒服","难受","好难受",
    "姨妈巾","卫生巾","卫生棉","护垫","棉条",
    "来m了","来M了","大姨母","亲戚来了",
    "经期日历","月经日历","查看经期","看经期","看月经",
    "period","cramp","menstrual","pms"
  ];
  return keywords.some(k => text.toLowerCase().includes(k.toLowerCase()));
}

function buildPeriodContext() {
  if (periodData.cycles.length === 0) return "\n\n<period-info>\n【用户称呼代词的所有格，如：她/他】的经期日历还没有记录。如果【用户称呼代词】问起，温柔地提醒【用户称呼代词】可以点右上角🩸按钮开始记录。\n</period-info>";
  const today = fmtD(new Date());
  const onPeriod = isCurrentlyOnPeriod();
  const phase = getCyclePhase(today);
  const nextPeriod = getNextPeriodDate();
  const avgCycle = getAverageCycleLength();
  const todayLog = periodData.dailyLogs[today];

  let ctx = `\n\n<period-info>
[【用户称呼代词的所有格】的经期日历数据 — 用自然的【角色身份】口吻告诉【用户称呼代词】，不要像读报告一样列数据]
`;
  if (onPeriod) {
    const last = getLastCycle();
    const daysSince = Math.floor((Date.now() - new Date(last.startDate + "T00:00:00").getTime()) / 86400000) + 1;
    ctx += `当前状态：经期中，第${daysSince}天（${last.startDate}开始）。要特别关心【用户称呼代词】，提醒【用户称呼代词】喝热水、注意保暖、多休息。\n`;
  } else if (phase) {
    ctx += `当前状态：${phase.label}，第${phase.day}天，平均周期${avgCycle}天。\n`;
  }
  if (nextPeriod && !onPeriod) {
    const daysUntil = Math.ceil((nextPeriod - Date.now()) / 86400000);
    if (daysUntil <= 3 && daysUntil > 0) {
      ctx += `⚠️ 距离下次经期预计还有${daysUntil}天！【用户称呼代词】可能快来了，PMS症状可能出现（情绪波动、疲劳、腹胀等）。要温柔耐心。\n`;
    } else if (daysUntil <= 0) {
      ctx += `⚠️ 按预测今天可能来月经了。关心【用户称呼代词】是不是来了。\n`;
    } else {
      ctx += `下次经期预计${nextPeriod.getMonth()+1}月${nextPeriod.getDate()}日（还有${daysUntil}天）。\n`;
    }
  }
  // Today's log
  if (todayLog) {
    let parts = [];
    if (todayLog.mood) parts.push(`心情${todayLog.mood}`);
    if (todayLog.symptoms && todayLog.symptoms.length > 0) parts.push(`症状：${todayLog.symptoms.join("、")}`);
    if (todayLog.waterCups) parts.push(`喝了${todayLog.waterCups}杯水`);
    if (todayLog.sleep) parts.push(`睡眠${todayLog.sleep}`);
    if (todayLog.exerciseType) parts.push(`运动：${todayLog.exerciseType}${todayLog.exerciseDuration ? todayLog.exerciseDuration+"分钟" : ""}`);
    if (todayLog.skincare && todayLog.skincare.length > 0) parts.push(`护肤：${todayLog.skincare.join("、")}`);
    if (parts.length > 0) ctx += `今日打卡：${parts.join("，")}。\n`;
  }
  // Last 2 days for trend
  for (let offset = 1; offset <= 2; offset++) {
    const d = new Date(Date.now() - offset * 86400000);
    const ds = fmtD(d);
    const log = periodData.dailyLogs[ds];
    if (!log) continue;
    let parts = [];
    if (log.mood) parts.push(log.mood);
    if (log.symptoms && log.symptoms.length) parts.push(log.symptoms.join("·"));
    if (log.sleep) parts.push("睡眠" + log.sleep);
    if (parts.length > 0) ctx += `${offset}天前：${parts.join("，")}。\n`;
  }
  // Recent cycle history
  const sorted = [...periodData.cycles].sort((a,b) => b.startDate.localeCompare(a.startDate));
  if (sorted.length >= 2) {
    const recent = sorted.slice(0, 3).map(c => {
      const len = c.endDate ? Math.ceil((new Date(c.endDate) - new Date(c.startDate)) / 86400000) + 1 : "进行中";
      return `${c.startDate}(${len}天)`;
    });
    ctx += `最近几次经期：${recent.join("、")}。\n`;
  }
  ctx += `用自然贴心的语气回应，根据【用户称呼代词的所有格】的状态给出关心和建议。不要生硬地列数据。
</period-info>`;
  return ctx;
}
