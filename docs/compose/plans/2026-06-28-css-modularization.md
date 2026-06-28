# CSS Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1856-line `styles.css` into 12 component-based CSS modules loaded via a single `main.css` entry point with `@import`.

**Architecture:** Each CSS module corresponds to a UI component or concern. `main.css` uses `@import` to load them in dependency order. Responsive rules are co-located within each component's file.

**Tech Stack:** Pure CSS, no build tools required.

## Global Constraints

- All CSS content must be preserved verbatim — no style changes, no reformatting
- Each module file must include its own `@media` responsive rules where applicable
- `index.html` must be updated to reference `styles/main.css` instead of `styles.css`
- The old `styles.css` must be deleted after verification

---

### Task 1: Create directory structure and theme/base modules

**Files:**
- Create: `styles/themes.css`
- Create: `styles/base.css`
- Create: `styles/main.css` (partial, imports only these two initially)

**Steps:**

- [ ] **Step 1: Create `styles/` directory**

```bash
mkdir -p /home/qty/projects/chat/styles
```

- [ ] **Step 2: Create `styles/themes.css`**

Extract lines 1–145 from `styles.css` (the `:root` block and all `[data-theme]` blocks) into `styles/themes.css`.

- [ ] **Step 3: Create `styles/base.css`**

Extract these sections into `styles/base.css`:
- Lines 147–157: `*` reset + `body` styles
- Lines 848–857: Toast notification (`.toast`, `.toast.show`)
- Lines 1011–1043: Memory loading overlay (`#memoryLoadingOverlay`, `.progress-track`, `.progress-bar`, `@keyframes pulse-glow`)

- [ ] **Step 4: Create initial `styles/main.css`**

```css
@import url('themes.css');
@import url('base.css');
```

---

### Task 2: Create setup, header, and chat modules

**Files:**
- Create: `styles/setup.css`
- Create: `styles/header.css`
- Create: `styles/chat.css`

**Steps:**

- [ ] **Step 1: Create `styles/setup.css`**

Extract lines 159–203 (`.setup-overlay`, `.setup-card`, `.setup-hint`, `.remember-row`).

- [ ] **Step 2: Create `styles/header.css`**

Extract these sections:
- Lines 205–270: Header bar (`.header`, `.avatar`, `.header-name`, `.header-status`, `.avatar-editor`, `.header-right`, `.header-btn`)
- Lines 992–1009: Theme picker (`.theme-picker`, `.theme-grid`, `.theme-item`, `.theme-dot`)

Include the responsive rules from lines 1144–1167 that apply to header elements.

- [ ] **Step 3: Create `styles/chat.css`**

Extract these sections:
- Lines 272–386: Chat area, messages, bubbles, sticker picker (`.chat-area`, `.empty-state`, `.msg-row`, `.msg-actions`, `.bubble`, `.english`, `.chinese`, `.bubble-audio`, `.msg-time`, `.load-more-banner`, `.file-download-btn`, `.file-attach-tag`, `.sticker-img`, `.sticker-picker`, `.sticker-grid`, `.sticker-grid-item`, `.sticker-empty`)
- Lines 746–780: Misc message components (`.td-choice`, `.user-sticker-img`, `.loading-bubble`, `@keyframes pulse`, `.dot`, `.error-msg`, `.quote-block`)
- Lines 950–990: Voice bubble + screenshot (`.voice-bubble`, `.voice-player`, `.voice-bar`, `@keyframes bar-dance`, `.voice-text`, `.peek-screenshot`, `.peek-label`)
- Lines 723–744: Search bar (`.search-bar`, `.search-bar-row`, `.search-results`, `.search-result-item`, `.search-highlight`, `@keyframes search-highlight`)

Include responsive rules from lines 1169–1170 (`.chat-area`, `.bubble`), 1215–1216 (`.sticker-picker`, `.sticker-grid`).

- [ ] **Step 4: Update `styles/main.css`**

```css
@import url('themes.css');
@import url('base.css');
@import url('setup.css');
@import url('header.css');
@import url('chat.css');
```

---

### Task 3: Create panel modules (feed, diary, dressup, roleplay)

**Files:**
- Create: `styles/panels.css`
- Create: `styles/diary.css`
- Create: `styles/dressup.css`
- Create: `styles/roleplay.css`

**Steps:**

- [ ] **Step 1: Create `styles/panels.css`**

Extract these sections:
- Lines 388–460: Feed panel (`.feed-panel`, `.feed-panel-header`, `.feed-category`, `.feed-grid`, `.feed-item`, `.feed-reaction`, `@keyframes feed-pop`, `.feed-scroll`, `.feed-input-bar`, `.feed-selected-preview`, `.feed-input-row`, `.feed-overlay`)
- Lines 462–500: Game panel (`.game-panel`, `.game-panel-header`, `.game-card`, `.game-banner`, `.game-overlay`)
- Lines 1112–1137: Features sidebar (`.features-overlay`, `.features-sidebar`, `.feature-item`)

Include responsive rules from lines 1192–1199 (`.feed-panel`, `.diary-panel`, `.dressup-panel`, `.features-sidebar`, `.game-panel`, `.music-panel` widths).

- [ ] **Step 2: Create `styles/diary.css`**

Extract lines 502–610 (`.diary-panel`, `.diary-card`, `.diary-empty`, `.diary-detail-view`, `.diary-generating`, `@keyframes diary-write`, `.diary-overlay`, `.diary-new-badge`, `@keyframes diary-badge-pulse`, `.diary-breadcrumb`, `.diary-archive-card`).

- [ ] **Step 3: Create `styles/dressup.css`**

Extract lines 612–683 (`.dressup-panel`, `.dressup-current`, `.dressup-option`, `.dressup-preview`, `.dressup-overlay`).

- [ ] **Step 4: Create `styles/roleplay.css`**

Extract lines 685–721 (`.rp-modal`, `.rp-modal-content`, `.rp-section-label`, `.rp-slots-grid`, `.rp-slot`, `.rp-field`, `.rp-start-btn`, `.rp-save-btn`, `.rp-banner`, `.rp-bubble`, `.rp-ooc-bubble`, `.rp-system-msg`).

Include responsive rules from lines 1201–1202 (`.rp-modal-content`, `.rp-slots-grid`).

- [ ] **Step 5: Update `styles/main.css`**

```css
@import url('themes.css');
@import url('base.css');
@import url('setup.css');
@import url('header.css');
@import url('chat.css');
@import url('panels.css');
@import url('diary.css');
@import url('dressup.css');
@import url('roleplay.css');
```

---

### Task 4: Create input, music, and debug modules

**Files:**
- Create: `styles/input.css`
- Create: `styles/music.css`
- Create: `styles/debug.css`

**Steps:**

- [ ] **Step 1: Create `styles/input.css`**

Extract these sections:
- Lines 786–806: Reply preview bar (`.reply-preview-bar`)
- Lines 808–846: Staged bar (`.staged-bar`, `.staged-msg-chip`, `.done-btn`)
- Lines 859–948: Input area, attach menu, voice input, image preview, hold-to-talk, recording hint (`.input-area`, `.chat-input`, `.send-btn`, `.attach-wrapper`, `.attach-menu`, `.input-mode-btn`, `.img-preview-bar`, `.user-img-msg`, `.hold-to-talk`, `.recording-hint`, `@keyframes rec-blink`)
- Lines 1432–1856: Prompt input box (`.prompt-input-box`, `.prompt-textarea`, `.prompt-preview-bar`, `.prompt-actions`, `.prompt-action-btn`, `.prompt-toggle-btn`, `.prompt-send-btn`, `.prompt-divider`, `.voice-visualizer`, `.voice-autoplay-toggle`, `@keyframes voice-bar-pulse`)

Include responsive rules from lines 1172–1190 (`.input-area`, `.prompt-input-box`, `.prompt-textarea`, `.prompt-toggle-btn`, `.prompt-action-btn`), 1224–1226 (`.img-preview-bar`, `.reply-preview-bar`, `.staged-bar`), and lines 1837–1856 (`@media max-width: 480px`).

- [ ] **Step 2: Create `styles/music.css`**

Extract lines 1044–1110 (`.music-panel`, `.music-overlay`, `.music-track`, `.music-empty`, `.mini-player`, `.mp-*`, `.music-notif`, `.jump-back-btn`).

Include responsive rules from lines 1210–1213 (`.mini-player`).

- [ ] **Step 3: Create `styles/debug.css`**

Extract lines 1229–1430 (`.debug-mode`, `.debug-panel`, `.debug-panel-header`, `.debug-log-entry`, `.debug-log-level`, etc.).

Include responsive rules from lines 1422–1430.

- [ ] **Step 4: Complete `styles/main.css`**

```css
@import url('themes.css');
@import url('base.css');
@import url('setup.css');
@import url('header.css');
@import url('chat.css');
@import url('panels.css');
@import url('diary.css');
@import url('dressup.css');
@import url('roleplay.css');
@import url('input.css');
@import url('music.css');
@import url('debug.css');
```

---

### Task 5: Update HTML and verify

**Files:**
- Modify: `index.html`
- Delete: `styles.css`

**Steps:**

- [ ] **Step 1: Update `index.html` stylesheet reference**

Change line 7 from:
```html
<link rel="stylesheet" href="styles.css">
```
to:
```html
<link rel="stylesheet" href="styles/main.css">
```

- [ ] **Step 2: Verify in browser**

Open `index.html` in a browser and visually confirm:
- All themes load and switch correctly
- All panels (feed, game, diary, dressup, roleplay, music, features) open/close properly
- Chat messages display correctly
- Input area renders properly
- Debug panel works
- Responsive layout works at mobile widths

- [ ] **Step 3: Delete old `styles.css`**

```bash
rm /home/qty/projects/chat/styles.css
```

- [ ] **Step 4: Commit**

```bash
git add styles/ index.html
git rm styles.css
git commit -m "refactor: split styles.css into component-based CSS modules"
```
