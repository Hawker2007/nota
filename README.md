# nota

A lightweight personal note-taking app for Windows 11.  
Dark terminal aesthetic · Markdown + code blocks · Tabs & groups · Tray icon · Files saved as `.md` in `~/Documents/Nota/`

---

## Prerequisites

Install these once:

```powershell
# 1. Rust (includes cargo)
winget install Rustlang.Rustup

# 2. Node.js (LTS)
winget install OpenJS.NodeJS

# 3. Restart your terminal, then verify
rustc --version
node --version
```

> WebView2 is already bundled with Windows 11 — nothing extra needed.

---

## Setup

```bash
# Clone / unzip the project, then:
cd nota-tauri

# Install JS dependencies
npm install

# Dev mode (hot reload, opens app window)
npm run tauri dev
```

---

## Build (release .exe)

```bash
npm run tauri build
```

Output files:
- `src-tauri/target/release/nota.exe` — standalone executable
- `src-tauri/target/release/bundle/nsis/nota_0.1.0_x64-setup.exe` — installer

---

## Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+Space` | Show / hide window (works globally) |
| `Ctrl+Shift+N` | New note + show window (works globally) |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| Ctrl+\` | Inline code |
| `Ctrl+K` | Insert link |
| `Tab` | Indent (2 spaces) |

---

## File storage

Notes are saved as plain `.md` files:

```
~/Documents/Nota/
  Work/
    API Design Notes.md
    Sprint Retrospective.md
  Personal/
    Book List 2025.md
  Archive/
    Old Project Ideas.md
```

Files are written 600ms after you stop typing.  
You can open, edit, and sync them with any tool (git, Obsidian, VS Code, etc.).

---

## Tray

- Closing the window hides it to the system tray (does **not** quit)
- Left-click tray icon → toggle window
- Right-click tray icon → menu with Show / New note / Quit

---

## Customise the icon

Replace the placeholder images in `src-tauri/icons/` with your own.  
You can generate all sizes from a single PNG using:

```bash
npx tauri icon your-icon.png
```

---

## Notes on the Rust backend (src-tauri/src/main.rs)

| Function | Purpose |
|---|---|
| `save_note` | Writes `~/Documents/Nota/<group>/<title>.md` |
| `delete_note` | Removes the `.md` file |
| `rename_note` | Renames the file on disk |
| `load_all_notes` | Scans the directory tree and returns all notes as JSON |
| `get_notes_dir` | Returns the path string for display in the UI |

The React frontend calls these via `invoke()` from `@tauri-apps/api`.  
If running in a plain browser (no Tauri), it falls back to `localStorage` automatically.
