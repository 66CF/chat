# 💡 优化 /chat 聊天响应速度 — Brainstorm

## ✅ 已实施的优化

### 方案 1 + 2：Chat 改用 Streaming + TTS 并行化

**改动文件**：
- `js/chat.js` — 新增 `fetchTTSForMessage()` 工具函数；`showMultipleMessages()` 改为并行 TTS；`sendMessage()` 文本路径改用 `callMiMoAPIStream()`；批量发送也已优化
- `js/voice.js` — 语音消息发送改用 Streaming + 并行 TTS
- `js/app.js` — 主动消息 & 屏幕截图消息均改用 Streaming + 并行 TTS

**优化后时序**：
```
用户发送
  ├── [1] 基础 system prompt → 0ms
  ├── [2] LLM Streaming → 首 token ~0.5秒
  │     ├── 第一条 JSON 完整 → 立刻发起 TTS（不阻塞）
  │     ├── 第二条 JSON 完整 → 立刻发起 TTS（不阻塞）
  │     └── 第三条 JSON 完整 → 立刻发起 TTS（不阻塞）
  ├── [3] 显示文字 + 等待对应 TTS（TTS 已在并行执行）
  └── TTS 陆续返回 → 补上音频播放

用户看到第一条文字+语音: ~2秒 (vs 优化前 ~4-6秒)
用户看到所有文字+语音: ~4秒 (vs 优化前 ~8-12秒)
```

**关键设计**：
1. `fetchTTSForMessage(english, index)` — 提取的 TTS 单条请求函数，DB 写入不阻塞
2. `showMultipleMessages(messages, ttsPrefetch)` — 接受可选的预取 TTS Map，内部全部并行发起
3. Streaming `onChunk` 回调用 `extractCompleteMessages()` 检测完整 JSON，立即 `ensureTTS()` 发起 TTS
4. 打字延迟从 600-1200ms 降至 300-500ms

---

## 当前流程瓶颈分析（优化前）

一次普通文字消息的完整时序：

```
用户发送
  ├── [1] buildSystemWithRecall()
  │     ├── ImprintMemory.surfacingSearch()   ← 🔴 Google Embedding API (200-500ms)
  │     │     └── vectorSearch() → fetch Google Gemini embedding
  │     ├── keywordSearch()                    ← 🟢 本地，快
  │     ├── searchRawHistory()                 ← 🟢 本地，快
  │     └── 拼接 system prompt
  │
  ├── [2] callMiMoAPI()                       ← 🔴 等完整响应 (1-4秒)
  │     └── 非 streaming，等所有 token 生成完
  │
  ├── [3] parseMiMoResponse()                 ← 🟢 本地，快
  │
  └── [4] showMultipleMessages()              ← 🔴🔴 串行 TTS (每条 0.5-1.5秒 × N条)
        └── for each msg:
              ├── TTS fetch (串行等待!)        ← 🔴 网络请求
              ├── AudioDB.save() (await!)       ← 🔴 阻塞下一条
              ├── appendBotMessage()
              └── sleep(600-1200ms)             ← ⚪ 模拟打字延迟
```

**总延迟估算**：
- Embedding recall: ~300ms
- LLM 生成: ~2-4秒
- 3条消息 TTS 串行: ~2-4秒
- 打字模拟延迟: ~2秒
- **总计: ~7-12秒 用户才能看到全部回复**

---

## 优化方案（按影响大小排序）

### 🥇 方案 1：Chat 模式改用 Streaming（影响最大）

**现状**：`sendMessage()` 用 `callMiMoAPI()` 等待完整响应
**对照**：`handleCallMessage()` 已经用了 `callMiMoAPIStream()` + 并行 TTS

**方案**：
- `sendMessage()` 也改用 `callMiMoAPIStream()`
- 用 `extractCompleteMessages()` 检测到完整 JSON 对象就立刻开始 TTS
- **效果**：LLM 还没生成完时，第一条消息的 TTS 已经在跑了，省掉等完整响应的时间

```js
// 伪代码
const ttsQueue = [];
let detected = 0;

const rawText = await callMiMoAPIStream({
  system, messages, max_tokens: 650,
  onChunk: (accumulated) => {
    const msgs = extractCompleteMessages(accumulated);
    for (let i = detected; i < msgs.length; i++) {
      ttsQueue.push(startTTS(i, msgs[i].english));  // 不 await，立即发起
    }
    detected = Math.max(detected, msgs.length);
  }
});
```

**预估提升**: LLM 响应 + TTS 从串行变并行，省 2-4 秒

---

### 🥈 方案 2：TTS 并行化 + 消息先显示文字

**现状**：`showMultipleMessages()` 里 TTS 串行，每条消息要等 TTS 完才显示

**方案 A — TTS 全并行**：
```js
// 同时发起所有 TTS 请求
const ttsPromises = messages.map((msg, i) => generateTTS(msg.english, i));
// 逐条显示文字，TTS 好了就挂上
for (let i = 0; i < messages.length; i++) {
  const { audioUrl, savedAudioId } = await ttsPromises[i];
  appendBotMessage(messages[i].english, messages[i].chinese, audioUrl, true, savedAudioId);
}
```

**方案 B — 文字先行，TTS 后补**：
```js
// 立刻显示所有文字消息（无音频）
for (const msg of messages) {
  appendBotMessage(msg.english, msg.chinese, null, true, null);
}
// 后台并行生成 TTS，好了再补上音频按钮
for (let i = 0; i < messages.length; i++) {
  generateTTS(messages[i].english).then(({ audioUrl, savedAudioId }) => {
    patchAudioToMessage(i, audioUrl, savedAudioId);
  });
}
```

**预估提升**: 用户看到文字的时间从 5-8 秒降到 3-4 秒

---

### 🥉 方案 3：Embedding Recall 异步化 / 预计算

**现状**：`buildSystemWithRecall()` 必须等 Google Embedding API 返回才能继续

**方案 A — Fire-and-forget（推荐）**：
```js
// 不阻塞 LLM 调用，embedding 异步返回后注入后续对话
const recallPromise = ImprintMemory.surfacingSearch(text);
// 先用无 recall 的 system prompt 调 LLM
const basePrompt = buildSystemPromptWithoutRecall();
callMiMoAPIStream({ system: basePrompt, ... });

// 或者：用上一次的 recall 结果缓存
const recallText = lastRecallResult || "";
```

**方案 B — 预热 Embedding**：
```js
// 用户开始打字时就预计算 embedding（debounce 500ms）
chatInput.addEventListener('input', debounce(() => {
  const text = chatInput.value.trim();
  if (text.length > 5) ImprintMemory.prefetchEmbedding(text);
}, 500));
```

**方案 C — 本地 Embedding**：
- 用 ONNX Runtime Web / Transformers.js 在浏览器本地跑 embedding
- 省掉网络往返，但首次加载模型较大（~30MB）
- 可以用 `all-MiniLM-L6-v2` 之类轻量模型

**预估提升**: 省 200-500ms

---

### 方案 4：AudioDB 写入异步化

**现状**：`await AudioDB.save(savedAudioId, ab)` 阻塞消息显示循环

**方案**：
```js
// 写入不阻塞显示
AudioDB.save(savedAudioId, ab).catch(e => console.warn("DB save error:", e));
// 立刻继续显示下一条
```

**预估提升**: 每条消息省 10-50ms（累计可省 50-250ms）

---

### 方案 5：减少打字模拟延迟

**现状**：每条消息间 600-1200ms 随机延迟

**方案**：
- 缩短为 300-500ms
- 或根据消息数量动态调整：1条 = 0ms，2条 = 300ms each，5条 = 200ms each
- 用户可以在设置里关掉

**预估提升**: 省 1-2 秒（多条消息时）

---

### 方案 6：System Prompt 精简 / 缓存

**现状**：system prompt 每次重新拼接（base + time + stickers + recall + diary + music + game）

**方案**：
- **缓存不变部分**：base prompt、sticker catalog 很少变，可以缓存
- **精简 token 数**：审查 SYSTEM_PROMPT 中是否有冗余描述
- **时间块简化**：不需要每次发完整时间格式，简写即可
- **Sticker catalog 按需注入**：不需要每次都带，只在相关时注入

**预估提升**: 减少 prompt tokens → LLM 响应更快（减少 100-300ms），长期省 token 费用

---

### 方案 7：智能上下文窗口

**现状**：`conversationHistory.slice(-20)` 固定取最近 20 条

**方案**：
- 动态窗口：简单消息多取，长消息少取（按 token 数计算而非条数）
- 消息压缩：对旧消息做摘要，只保留最近 5 条完整 + 更早的摘要

```js
function getSmartContext(history, maxTokens = 4000) {
  const result = [];
  let tokenCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const tokens = estimateTokens(msg.content);
    if (tokenCount + tokens > maxTokens) break;
    result.unshift(msg);
    tokenCount += tokens;
  }
  return result;
}
```

**预估提升**: 减少 LLM 处理的 tokens → 响应更快

---

### 方案 8：TTS 缓存 / 预生成

**方案**：
- **常用回复缓存**：对类似输入（"嗯"、"好的"、"哈哈"等高频回复）缓存 TTS 结果
- **预生成**：LLM 流式输出时，对已确定的前缀文本预生成 TTS

```js
const ttsCache = new Map(); // text → { audioUrl, timestamp }
async function getCachedTTS(text) {
  const key = text.toLowerCase().trim();
  if (ttsCache.has(key)) return ttsCache.get(key);
  const result = await generateTTS(text);
  ttsCache.set(key, result);
  // LRU: 删除超过 100 条的旧缓存
  if (ttsCache.size > 100) ttsCache.delete(ttsCache.keys().next().value);
  return result;
}
```

**预估提升**: 缓存命中时省 0.5-1.5 秒

---

### 方案 9：Predictive Prefetch / Speculative Execution

**方案**：
- 用户输入很短消息时（如"嗯"、"好的"），预判可能是简单回复
- 在等待 LLM 时就预热 TTS 引擎连接
- 预请求 mic 权限（已有 `initMicStream()` 做了这个）

---

### 方案 10：网络层优化

**方案**：
- **HTTP/2 复用**：确保 API endpoint 支持 HTTP/2，减少连接建立开销
- **请求合并**：如果 TTS 支持 batch，一次发多条文本
- **压缩**：请求/响应 gzip 压缩
- **Keep-Alive**：确保 fetch 使用持久连接

---

## 🎯 推荐实施优先级

| 优先级 | 方案 | 难度 | 预估提升 |
|--------|------|------|----------|
| P0 | 方案1: Streaming + 并行TTS | 中 | **3-5秒** |
| P0 | 方案2: TTS并行 + 文字先行 | 中 | **2-4秒** |
| P1 | 方案3: Embedding异步化 | 低 | 300-500ms |
| P1 | 方案5: 减少打字延迟 | 低 | 1-2秒 |
| P2 | 方案4: AudioDB异步写入 | 低 | 50-250ms |
| P2 | 方案6: System Prompt精简 | 低 | 100-300ms |
| P2 | 方案8: TTS缓存 | 中 | 0.5-1.5秒(命中时) |
| P3 | 方案7: 智能上下文窗口 | 中 | 200-500ms |
| P3 | 方案9: 预测性预取 | 高 | 不定 |
| P3 | 方案10: 网络层优化 | 低 | 100-300ms |

## 💡 最佳组合：方案 1 + 2 + 3 + 5

如果只做 4 件事：
1. **Chat 模式改为 Streaming**（代码已有，只需迁移）
2. **TTS 并行发起 + 文字先行显示**
3. **Embedding recall 不阻塞主流程**
4. **打字延迟从 600-1200ms 降到 200-400ms**

**优化后时序估算**：
```
用户发送
  ├── [1] 基础 system prompt（无 recall 阻塞） → 0ms
  ├── [2] LLM Streaming → 首 token ~0.5秒
  │     ├── 第一条 JSON 完整 → 立刻显示文字 + 发起 TTS
  │     ├── 第二条 JSON 完整 → 立刻显示文字 + 发起 TTS  
  │     └── 第三条 JSON 完整 → 立刻显示文字 + 发起 TTS
  ├── [3] TTS 并行返回（与 LLM 生成重叠） → 补上音频
  └── 异步: embedding recall 完成 → 缓存给下次用

用户看到第一条文字: ~1-1.5秒 (vs 当前 ~3-4秒)
用户看到所有文字: ~3秒 (vs 当前 ~5-7秒)  
用户看到所有文字+语音: ~4秒 (vs 当前 ~8-12秒)
```

**预计总体提速 50-60%**
