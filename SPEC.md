# nota — Project Specification

## Overview

**nota** is a lightweight personal note-taking desktop app for Windows 11, built with Tauri v2 (Rust + React). It features a dark terminal aesthetic, markdown editing with live preview, and saves notes as plain `.md` files on disk.

- **Version:** 0.1.0
- **Identifier:** `dev.nota.nota`
- **License:** MIT

---

## Architecture

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 (JSX) |
| Build tool | Vite 6 |
| Backend | Tauri 2.x (Rust) |
| Rendering | WebView2 (Windows 11) |
| Styling | Inline CSS + injected stylesheet |

### Project Structure

```
nota-tauri/
├── index.html              # Entry HTML, base styles
├── package.json            # JS dependencies & scripts
├── vite.config.js          # Vite configuration
├── src/
│   ├── main.jsx            # React entry point
│   └── App.jsx             # Single-file React app (~832 lines)
└── src-tauri/
    ├── Cargo.toml           # Rust dependencies
    ├── tauri.conf.json      # Tauri configuration
    ├── build.rs             # Tauri build script
    ├── capabilities/
    │   └── default.json     # v2 ACL capability definitions
    └── src/
        ├── main.rs          # Entry point (~13 lines) — calls app_lib::run()
        └── lib.rs           # Tauri library (~320 lines) — backend logic
```

---

## Features

### Core

| Feature | Description |
|---|---|
| **Groups** | Notes organized into color-coded groups (e.g., Work, Personal, Archive) |
| **Tabs** | Multi-tab note editing — open multiple notes simultaneously |
| **Markdown editing** | Full markdown editor with toolbar (bold, italic, strikethrough, headings, lists, code blocks, links, quotes, task checkboxes, tables) |
| **Live preview** | Three view modes: Edit, Split (edit+preview side-by-side), Preview |
| **Font size control** | `Ctrl+=`/`Ctrl+-` or **−**/**+** buttons in titlebar (10–24px range) |
| **Search** | Full-text search across all notes (title + content) |
| **Sidebar** | Collapsible sidebar with group/note tree |
| **Context menu** | Right-click note → Rename, Copy content, Delete |
| **Auto-save** | Notes saved to disk 600ms after typing stops |
| **Word/char count** | Status bar shows word count, char count, save status |
| **Single-instance** | Only one app instance allowed; second launch exits silently |
| **Double Escape** | Pressing Escape twice within 500ms hides window to tray |
| **Config persistence** | Font size and other settings saved to `~/Documents/Nota/config.md` |

### Markdown Support

| Syntax | Rendering |
|---|---|
| `#`, `##`, `###` | Headings (1.5em, 0.82em uppercase, 1.05em relative to base) |
| `**bold**`, `*italic*`, `~~strikethrough~~` | Inline formatting |
| `` `inline code` `` | Styled code block |
| `\`\`\`lang … \`\`\`` | Code block with language label |
| `- item`, `1. item` | Unordered & ordered lists |
| `- [ ]`, `- [x]`, `[ ]`, `[x]` | Interactive task checkboxes (click to toggle) |
| `\| H1 \| H2 \| … \|` | Tables with `table-layout: fixed`, grid borders, distinct header bg |
| `> quote` | Blockquotes with left border |
| `---` | Horizontal rule |
| `[text](url)` | Links (open in external browser) |

### System Integration

| Feature | Details |
|---|---|
| **System tray** | Tray icon with menu: Show/Hide, New note, Quit |
| **Global shortcuts** | `Ctrl+Shift+Space` → toggle window, `Ctrl+Shift+N` → new note |
| **Close to tray** | Closing the window hides to tray instead of quitting |
| **File storage** | Plain `.md` files in `~/Documents/Nota/<Group>/<Title>.md` |
| **Config file** | Settings stored in `~/Documents/Nota/config.md` as JSON |

### Editor Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `` Ctrl+` `` | Inline code |
| `Ctrl+K` | Insert link |
| `Ctrl+=` | Increase font size |
| `Ctrl+-` | Decrease font size |
| `Tab` | Indent (2 spaces) |

---

## Frontend (App.jsx)

### State Management

- **Single component** — all state lives in `Nota` component via `useState`
- **Persistence** — groups stored in `localStorage` key `nota_groups`; config stored via Tauri backend to `config.md`
- **No external state library** — no Redux, Zustand, etc.

### Key State Variables

| Variable | Type | Purpose |
|---|---|---|
| `groups` | `Array<Group>` | All groups with their notes |
| `openTabs` | `Array<{noteId, groupId}>` | Currently open tab references |
| `activeNote` | `string` | ID of the currently active note |
| `mode` | `"edit" \| "split" \| "preview"` | Editor view mode (default: `"preview"`) |
| `search` | `string` | Search query string |
| `sidebarOpen` | `boolean` | Sidebar visibility |
| `saveStatus` | `"saved" \| "saving…"` | File save indicator |
| `fontSize` | `number` | Editor/preview font size (10–24, default 13.5) |
| `editingTitleOriginal` | `string \| null` | Tracks original title during rename for undo |
| `notesDir` | `string` | Path label shown in titlebar |
| `expanded` | `Object` | Group expansion state |
| `newGroupEditing` | `boolean` | New group input mode |
| `newGroupName` | `string` | Pending new group name |

### Components (all in one file)

| Component | Purpose |
|---|---|
| `Nota` | Main app (default export) |
| `NoteRow` | Individual note item in sidebar (with context menu, inline rename) |
| `GroupDot` | Small colored dot indicator |
| `renderMarkdown` | Pure function — converts markdown string to HTML |

### Tauri Bridge

- Detects Tauri environment via `window.__TAURI__`
- Dynamically imports `invoke` from `@tauri-apps/api/core` and `listen` from `@tauri-apps/api/event`
- Falls back to `localStorage` when running in plain browser (dev mode)

### Markdown Renderer

Custom lightweight `renderMarkdown(text)` function supporting:
- Headings, bold, italic, strikethrough, inline code, links
- Code blocks with language labels
- Unordered & ordered lists
- Task checkboxes (interactive — toggles `[ ]` ↔ `[x]` via click)
- Tables (header row detected, separator row skipped, grid layout)
- Blockquotes, horizontal rules
- Blank line between tables → separate tables

### Disk Loading

- `loadGroupsFromDisk()` — invokes `load_all_notes` Tauri command, groups notes by directory, assigns colors from `GROUP_COLORS` palette
- Called on first mount; falls back to `DEFAULT_GROUPS` if no disk data found

---

## Backend (lib.rs + main.rs)

### Entry Point

- **`main.rs`** — checks single-instance mutex, calls `app_lib::run()`; uses `windows_subsystem = "windows"` in release
- **`lib.rs`** — all backend logic; exports `run()` via `[lib]` with `crate-type = ["staticlib", "cdylib", "rlib"]`

### Tauri Commands

| Command | Parameters | Returns | Purpose |
|---|---|---|---|
| `get_notes_dir` | `app: AppHandle` | `String` | Returns `~/Documents/Nota/` path |
| `save_note` | `group`, `filename`, `content` | `Result<(), String>` | Writes `.md` file |
| `delete_note` | `group`, `filename` | `Result<(), String>` | Removes `.md` file |
| `rename_note` | `group`, `old_filename`, `new_filename` | `Result<(), String>` | Renames file on disk |
| `load_all_notes` | `app: AppHandle` | `Result<String, String>` (JSON) | Scans directory tree, returns all notes |
| `hide_window` | `app: AppHandle` | `()` | Hides the main window |
| `save_config` | `content: String` | `Result<(), String>` | Saves config JSON to `config.md` |
| `load_config` | `app: AppHandle` | `Result<String, String>` | Loads config from `config.md` |

### System Tray

- **Config-based** — defined in `tauri.conf.json` with `id: "tray"`
- **Menu set programmatically** — `MenuItem` + `Menu` via `app.tray_by_id("tray")`
- **Menu items:** Show/Hide (with shortcut hint), New note, separator, Quit
- **Left-click:** Toggle window visibility (show_menu_on_left_click: false)
- **Right-click:** Shows context menu

### Global Shortcuts

- **`tauri-plugin-global-shortcut`** — `GlobalShortcutExt::on_shortcut()`
- `Ctrl+Shift+Space` → toggle window
- `Ctrl+Shift+N` → show window + emit `new-note` event

### Single-Instance

- Named Windows mutex: `Local\nota-single-instance-mutex`
- If mutex already held, `main.rs` returns early without launching

### Window Behavior

- Close event → `prevent_close()` + `hide()` (stays in tray)
- `show_window()` → `show()` + `set_focus()` + `unminimize()`
- `toggle_window()` → hide if visible and not minimized, else show
- Initial visibility: `visible: false` in config (shown via shortcut/tray)

### Path Resolution

- Uses `app.path().document_dir()` (Tauri v2 API) instead of `tauri::api::path`

---

## Data Structures

### Group

```typescript
interface Group {
  id: string;       // uid (random 7 chars or slugified name)
  name: string;
  color: string;    // hex color
  notes: Note[];
}
```

### Note

```typescript
interface Note {
  id: string;       // uid (random 7 chars or disk-prefixed)
  title: string;
  updated: string;  // "today", "yesterday", "Mar 28", etc.
  content: string;  // raw markdown
}
```

### Disk Format

Each note maps to a file: `~/Documents/Nota/<GroupName>/<Title>.md`

Filename sanitization: replaces `/ \ : * ? " < > |` with `-`, trims whitespace.

Config stored at: `~/Documents/Nota/config.md` (JSON format)

---

## Tauri v2 Capabilities

Permissions defined in `src-tauri/capabilities/default.json`:

| Capability | Permissions |
|---|---|
| `core:default` | Core app access |
| `fs:allow-*` | read-file, write-file, read-dir, copy-file, mkdir, remove, rename, exists |
| `fs:scope` | Scoped to `$DOCUMENT/Nota/**` and `$DOCUMENT/Nota` |
| `shell:allow-open` | Open external links |
| `notification:default` | System notifications |
| `global-shortcut:allow-*` | Register/unregister global hotkeys |
| `core:window:allow-*` | show, hide, set-focus, unminimize, is-visible |

---

## Window Configuration

| Property | Value |
|---|---|
| Default size | 1100 × 680 |
| Minimum size | 600 × 400 |
| Centered | Yes |
| Resizable | Yes |
| Decorations | Yes (standard title bar) |
| Transparent | No |
| Initial visibility | false (shown via shortcut/tray) |
| HTTPS scheme | Yes (`useHttpsScheme: true` to prevent LocalStorage reset in v2) |

---

## Default Starter Data

Three groups ship with sample notes:

| Group | Color | Notes |
|---|---|---|
| Work | `#534AB7` | API Design Notes, Sprint Retrospective |
| Personal | `#1D9E75` | Book List 2025 |
| Archive | `#888780` | Old Project Ideas |

### Group Color Palette

`#534AB7`, `#1D9E75`, `#D85A30`, `#D4537E`, `#BA7517`, `#378ADD`, `#639922`

---

## Build & Run

### Development

```bash
npm install
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

**Output:**
- `src-tauri/target/release/nota.exe` — standalone
- `src-tauri/target/release/bundle/nsis/nota_0.1.0_x64-setup.exe` — installer

### Prerequisites

- Rust (via `rustup`)
- Node.js LTS
- WebView2 (bundled with Windows 11)

---

## Dependencies

### Frontend

| Package | Version | Purpose |
|---|---|---|
| `react` | 18.2.0 | UI framework |
| `react-dom` | 18.2.0 | DOM rendering |
| `@tauri-apps/api` | ^2.0.0 | Tauri JS client |
| `@tauri-apps/plugin-fs` | ^2.5.0 | File system access |
| `@tauri-apps/plugin-notification` | ^2.3.3 | System notifications |
| `@tauri-apps/plugin-shell` | ^2.3.5 | Shell/open API |
| `@tauri-apps/plugin-global-shortcut` | ^2.3.1 | Global hotkeys |
| `esbuild` | ^0.28.0 | JS bundler |
| `vite` | ^6.3.5 | Build tool |
| `@vitejs/plugin-react` | ^4.2.0 | React plugin |
| `@tauri-apps/cli` | ^2.10.1 | Tauri CLI |

### Backend

| Crate | Version | Purpose |
|---|---|---|
| `tauri` | 2.x | Desktop app framework |
| `serde` | 1.x | Serialization |
| `serde_json` | 1.x | JSON handling |
| `tauri-plugin-fs` | 2 | File system plugin |
| `tauri-plugin-notification` | 2 | Notification plugin |
| `tauri-plugin-shell` | 2 | Shell/open plugin |
| `tauri-plugin-global-shortcut` | 2 | Global shortcut plugin |
| `keyboard-types` | 0.7 | `Code` enum for shortcuts |
| `windows-sys` | 0.52 | Native Windows APIs (single-instance mutex) |
| `pathdiff` | 0.2 | Path utilities |

---

## Key Changes from v1 → v2

| Area | v1 | v2 |
|---|---|---|
| Tauri version | 1.6 | 2.x |
| Entry point | `fn main()` in `main.rs` | `fn main()` + `fn run()` in `lib.rs` |
| File system | `fs-all` feature | `tauri-plugin-fs` |
| Shell | `shell-open` feature | `tauri-plugin-shell` |
| Notifications | `notification-all` feature | `tauri-plugin-notification` |
| Global shortcuts | `GlobalShortcutManager` | `GlobalShortcutExt::on_shortcut()` |
| Window API | `app.get_window()` | `app.get_webview_window()` |
| Events | `emit_all()` | `emit()` |
| Permissions | `allowlist` in `tauri.conf.json` | `capabilities/` JSON files |
| JS imports | `@tauri-apps/api/tauri` | `@tauri-apps/api/core` |
| Tray | `SystemTray` + `SystemTrayMenu` | `TrayIconBuilder` + `Menu`/`MenuItem` |
| Path resolution | `tauri::api::path::document_dir()` | `app.path().document_dir()` |
| Shortcut keys | String-based (`"KeyN"`) | `keyboard_types::Code::KeyN` |
| HTTP scheme | `https://` default | `http://` (opt-in `useHttpsScheme: true`) |
| Single-instance | N/A | Named mutex + early exit in `main.rs` |

---

## Known Limitations

1. **No sync** — notes are local-only; no cloud or multi-device support.
2. **Single-file frontend** — all React code in one `App.jsx`, not modularized.
3. **Windows-only** — uses Windows-specific tray behavior and WebView2.
4. **No rich text editing** — plain textarea with markdown, no WYSIWYG.
5. **No tags or cross-group linking** — notes are strictly hierarchical (group → notes).
6. **No export/import** — no backup or migration tools built in.
7. **Table alignment** — `table-layout: fixed` distributes columns evenly; no column-width control.
8. **LocalStorage fallback** — when running without Tauri, groups persist to `localStorage` but file I/O is unavailable.
9. **No search highlighting** — search filters notes but doesn't highlight matches in content.
10. **Config is minimal** — only font size is currently persisted to config.
