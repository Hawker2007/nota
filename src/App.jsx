// src/App.jsx
// nota — React frontend
// Wired to Tauri backend for file I/O, tray events, and global shortcuts.
// Falls back to localStorage when running in browser (dev without Tauri).

import { useState, useEffect, useRef, useCallback } from "react";

// ── Tauri bridge (graceful fallback for plain browser dev) ───────────────────
// We can't use top-level await (not supported in the build target), so we
// initialise lazily on first use via initTauri().

let tauriInvoke = null;
let tauriListen = null;

async function initTauri() {
  if (tauriInvoke) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen }  = await import("@tauri-apps/api/event");
    tauriInvoke = invoke;
    tauriListen = listen;
  } catch {
    // not in Tauri — stay null
  }
}

// ── tiny markdown renderer ───────────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const html = [];
  let inCode = false, codeLang = "", codeLines = [];
  let inUl = false, inOl = false;
  let inTable = false, tableRows = [];

  const flush = (type) => {
    if (type !== "ul" && inUl) { html.push("</ul>"); inUl = false; }
    if (type !== "ol" && inOl) { html.push("</ol>"); inOl = false; }
    if (type !== "table" && inTable) {
      const [header, ...body] = tableRows;
      const cells = (row) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      html.push("<table><thead><tr>" + cells(header).map(c => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>");
      for (const r of body) html.push("<tr>" + cells(r).map(c => `<td>${inline(c)}</td>`).join("") + "</tr>");
      html.push("</tbody></table>");
      inTable = false;
      tableRows = [];
    }
  };

  const esc = (s) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code class="ic">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  const isTableRow = (l) => /^\|.*\|/.test(l.trim());
  const isSeparator = (l) => /^\|[\s\-:|]+\|/.test(l.trim());

  for (const l of lines) {
    if (l.startsWith("```")) {
      if (!inCode) { flush(""); codeLang = l.slice(3).trim(); codeLines = []; inCode = true; }
      else {
        html.push(`<div class="cb"><span class="cl">${codeLang||"text"}</span><pre>${codeLines.map(esc).join("\n")}</pre></div>`);
        inCode = false;
      }
      continue;
    }
    if (inCode) { codeLines.push(l); continue; }
    if (!l.trim()) {
      if (inTable) { flush(""); }
      else { html.push('<div class="nl"></div>'); }
      continue;
    }
    if (/^# /.test(l))   { flush(""); html.push(`<h1>${inline(l.slice(2))}</h1>`); continue; }
    if (/^## /.test(l))  { flush(""); html.push(`<h2>${inline(l.slice(3))}</h2>`); continue; }
    if (/^### /.test(l)) { flush(""); html.push(`<h3>${inline(l.slice(4))}</h3>`); continue; }
    if (/^> /.test(l))   { flush(""); html.push(`<blockquote>${inline(l.slice(2))}</blockquote>`); continue; }
    if (/^---+$/.test(l.trim())) { flush(""); html.push("<hr/>"); continue; }
    // Task items: `- [ ]` or `- [x]` — check BEFORE bullet list (since `- [ ]` also starts with `- `)
    if (/^[-*] \[[ x]\] /.test(l)) {
      flush("ol"); if (!inUl) { html.push("<ul>"); inUl = true; }
      const checked = l[3]==="x";
      const taskText = l.slice(6);
      html.push(`<li class="task"><input type="checkbox" data-task="${esc(taskText)}" ${checked?"checked":""}/><span>${inline(taskText)}</span></li>`);
      continue;
    }
    if (/^\[[ x]\] /.test(l)) {
      flush("");
      const checked = l[1]==="x";
      const taskText = l.slice(4);
      html.push(`<div class="task"><input type="checkbox" data-task="${esc(taskText)}" ${checked?"checked":""}/><span>${inline(taskText)}</span></div>`);
      continue;
    }
    if (/^[-*] /.test(l)) {
      flush("ol"); if (!inUl) { html.push("<ul>"); inUl = true; }
      html.push(`<li>${inline(l.slice(2))}</li>`); continue;
    }
    if (/^\d+\. /.test(l)) {
      flush("ul"); if (!inOl) { html.push("<ol>"); inOl = true; }
      html.push(`<li>${inline(l.replace(/^\d+\. /,""))}</li>`); continue;
    }
    // Table detection — check separator BEFORE table row (separator also starts/ends with |)
    if (isSeparator(l) && (inTable || tableRows.length > 0)) continue;
    if (isTableRow(l)) {
      if (!inTable) { flush("table"); }
      tableRows.push(l.trim());
      inTable = true;
      continue;
    }
    flush(""); html.push(`<p>${inline(l)}</p>`);
  }
  flush("");
  return html.join("");
}

// ── helpers ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtDate = () => new Date().toLocaleDateString("en-US", { month:"short", day:"numeric" });
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const sanitizeFilename = (s) => s.replace(/[/\\:*?"<>|]/g, "-").trim() || "untitled";

// ── default starter data ─────────────────────────────────────────────────────
const DEFAULT_GROUPS = [
  {
    id:"work", name:"Work", color:"#534AB7",
    notes:[
      { id:"n1", title:"API Design Notes", updated:"today",
        content:`# API Design Notes\n\nUsing JWT with refresh token rotation. Access tokens expire after **15 min**, refresh tokens after 7 days stored in \`HttpOnly\` cookie.\n\n## Auth endpoints\n\n\`\`\`http\nPOST /auth/login\nPOST /auth/refresh\nDELETE /auth/logout\n\`\`\`\n\n## Notes\n\n- Rate limit login to 5 attempts / 10 min\n- CORS allow list defined in \`config.yaml\`\n- Consider PKCE flow for future mobile client\n\n## Types\n\n\`\`\`typescript\ninterface TokenPair {\n  access: string;\n  refreshExpiresAt: Date;\n}\n\`\`\`` },
      { id:"n2", title:"Sprint Retrospective", updated:"yesterday",
        content:`# Sprint Retrospective\n\n## What went well\n\n- Shipped the auth module on time\n- Good collaboration between front and back\n- Test coverage improved to **84%**\n\n## Blockers\n\n- CI pipeline flaky on Windows runners\n- Design handoff was late (again)\n\n## Action items\n\n- [ ] Fix Windows CI issue\n- [ ] Set design freeze date earlier\n- [x] Schedule retro for next sprint\n\n---\n\n> Next sprint goal: finish the dashboard MVP` }
    ]
  },
  {
    id:"personal", name:"Personal", color:"#1D9E75",
    notes:[
      { id:"n3", title:"Book List 2025", updated:"Mar 28",
        content:`# Book List 2025\n\n## Reading now\n\n- *The Staff Engineer's Path* — Tanya Reilly\n- *Four Thousand Weeks* — Oliver Burkeman\n\n## Want to read\n\n- Thinking in Systems\n- A Pattern Language\n- The Pragmatic Programmer (reread)\n\n## Finished\n\n- [x] Designing Data-Intensive Applications\n- [x] Staff Engineer (Will Larson)\n- [x] The Manager's Path` }
    ]
  },
  {
    id:"archive", name:"Archive", color:"#888780",
    notes:[
      { id:"n5", title:"Old Project Ideas", updated:"Jan 5",
        content:`# Old Project Ideas\n\n## Rust CLI tool\n\nA \`tig\`-like TUI for browsing log files. Wanted to use \`ratatui\`.\n\n## Game jam concept\n\nA puzzle game where you debug actual broken code to unlock doors.` }
    ]
  }
];

// ── persistence layer ────────────────────────────────────────────────────────
// In Tauri: writes each note as a real .md file under ~/Documents/Nota/<group>/
// In browser: falls back to localStorage

async function persistNote(group, title, content) {
  await initTauri();
  if (tauriInvoke) {
    await tauriInvoke("save_note", { group, filename: sanitizeFilename(title), content });
  }
}

async function deleteNoteFile(group, title) {
  await initTauri();
  if (tauriInvoke) {
    await tauriInvoke("delete_note", { group, filename: sanitizeFilename(title) });
  }
}

async function renameNoteFile(group, oldTitle, newTitle) {
  await initTauri();
  if (tauriInvoke) {
    await tauriInvoke("rename_note", {
      group,
      oldFilename: sanitizeFilename(oldTitle),
      newFilename: sanitizeFilename(newTitle),
    });
  }
}

async function persistConfig(config) {
  await initTauri();
  if (tauriInvoke) {
    await tauriInvoke("save_config", { content: JSON.stringify(config) });
  }
}

async function loadConfig() {
  await initTauri();
  if (!tauriInvoke) return null;
  try {
    const raw = await tauriInvoke("load_config");
    return JSON.parse(raw);
  } catch { return null; }
}

// ── components ───────────────────────────────────────────────────────────────
function GroupDot({ color, size=8 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:2, background:color, flexShrink:0 }} />;
}

// ── disk → groups loader ────────────────────────────────────────────────────
const GROUP_COLORS = ["#534AB7","#1D9E75","#D85A30","#D4537E","#BA7517","#378ADD","#639922"];

async function loadGroupsFromDisk() {
  await initTauri();
  if (!tauriInvoke) return null;
  try {
    const raw = await tauriInvoke("load_all_notes");
    const notes = JSON.parse(raw);
    if (!notes.length) return null;

    // Group notes by group name
    const grouped = {};
    let noteCounter = 0;
    for (const n of notes) {
      if (!grouped[n.group]) grouped[n.group] = [];
      noteCounter++;
      grouped[n.group].push({
        id: `disk-${noteCounter}-${n.title.slice(0, 8).replace(/\s+/g, "-").toLowerCase()}`,
        title: n.title,
        updated: n.updated,
        content: n.content,
      });
    }

    return Object.entries(grouped).map(([name, gNotes], i) => ({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      name,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      notes: gNotes,
    }));
  } catch (e) {
    console.warn("Failed to load notes from disk:", e);
    return null;
  }
}

// ── main app ─────────────────────────────────────────────────────────────────
export default function Nota() {
  const [groups, setGroups] = useState(() => {
    try { const s = localStorage.getItem("nota_groups"); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [notesDir, setNotesDir] = useState("");
  const [openTabs, setOpenTabs] = useState([]);
  const [activeNote, setActiveNote] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [mode, setMode] = useState("preview");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [newGroupEditing, setNewGroupEditing] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [saveStatus, setSaveStatus] = useState("saved");
  const [fontSize, setFontSize] = useState(13.5);
  const [editingTitleOriginal, setEditingTitleOriginal] = useState(null); // Track original title for rename
  const textareaRef = useRef(null);
  const saveTimer = useRef(null);
  const initDone = useRef(false);
  const escTimer = useRef(null); // Track double-escape timing
  const escCount = useRef(0); // Track escape key presses

  // Double Escape → hide window to tray
  useEffect(() => {
    const handleGlobalKeydown = async (e) => {
      if (e.key === "Escape") {
        escCount.current++;
        if (escCount.current === 1) {
          // First press - wait to see if there's a second
          escTimer.current = setTimeout(() => {
            escCount.current = 0;
          }, 500); // 500ms window for double-press
        } else if (escCount.current >= 2) {
          // Double press detected - hide window
          clearTimeout(escTimer.current);
          escCount.current = 0;
          await initTauri();
          tauriInvoke?.("hide_window").catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeydown);
      clearTimeout(escTimer.current);
    };
  }, []);

  // Load from disk on first mount
  useEffect(() => {
    if (initDone.current) return;
    initDone.current = true;

    // Load config first
    loadConfig().then(cfg => {
      if (cfg?.fontSize) setFontSize(cfg.fontSize);
    }).finally(() => {
      loadGroupsFromDisk().then(diskGroups => {
        if (diskGroups) {
          setGroups(diskGroups);
          const expandedMap = {};
          diskGroups.forEach(g => { expandedMap[g.id] = true; });
          setExpanded(expandedMap);
          // Open the first note if any
          const first = diskGroups[0]?.notes?.[0];
          if (first) {
            setOpenTabs([{ noteId: first.id, groupId: diskGroups[0].id }]);
            setActiveNote(first.id);
          }
        } else {
          setGroups(DEFAULT_GROUPS);
          setExpanded({ work: true, personal: true, archive: false });
          setOpenTabs([{ noteId: "n1", groupId: "work" }]);
          setActiveNote("n1");
        }
      });
    });
  }, []);

  // Fetch notes dir path label from Tauri
  useEffect(() => {
    initTauri().then(() => {
      tauriInvoke?.("get_notes_dir").then(setNotesDir).catch(() => {});
    });
  }, []);

  // Persist groups to localStorage whenever they change
  useEffect(() => {
    try { localStorage.setItem("nota_groups", JSON.stringify(groups)); } catch {}
  }, [groups]);

  // Persist font size to config.md (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      persistConfig({ fontSize }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [fontSize]);

  // Listen for tray/hotkey "new-note" event from Rust backend
  useEffect(() => {
    let unlisten;
    initTauri().then(() => {
      tauriListen?.("new-note", () => {
        const g = groups[0];
        if (g) createNote(g.id);
      }).then(fn => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [groups]);

  const allNotes = groups.flatMap(g =>
    g.notes.map(n => ({ ...n, groupId:g.id, groupColor:g.color, groupName:g.name }))
  );
  const findNote = (id) => allNotes.find(n => n.id === id);
  const findGroup = (id) => groups.find(g => g.id === id);
  const currentNote = findNote(activeNote);
  const currentGroup = currentNote ? findGroup(currentNote.groupId) : null;

  const filteredGroups = search
    ? groups.map(g => ({
        ...g,
        notes: g.notes.filter(n =>
          n.title.toLowerCase().includes(search.toLowerCase()) ||
          n.content.toLowerCase().includes(search.toLowerCase())
        )
      })).filter(g => g.notes.length > 0)
    : groups;

  const openNote = (noteId, groupId) => {
    if (!openTabs.find(t => t.noteId === noteId)) {
      setOpenTabs(t => [...t, { noteId, groupId }]);
    }
    setActiveNote(noteId);
  };

  const closeTab = (noteId, e) => {
    e?.stopPropagation();
    const remaining = openTabs.filter(t => t.noteId !== noteId);
    setOpenTabs(remaining);
    if (activeNote === noteId) {
      const last = remaining[remaining.length - 1];
      setActiveNote(last?.noteId ?? null);
    }
  };

  const scheduleFileSave = useCallback((groupName, title, content) => {
    setSaveStatus("saving…");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await persistNote(groupName, title, content).catch(console.error);
      setSaveStatus("saved");
    }, 600);
  }, []);

  const updateNote = useCallback((nid, field, val) => {
    setGroups(gs => gs.map(g => ({
      ...g,
      notes: g.notes.map(n => {
        if (n.id !== nid) return n;
        const updated = { ...n, [field]: val, updated: "today" };
        // Only schedule file save for content changes, not title changes
        // Title changes (renames) are handled separately via handleRename
        if (field === "content") {
          const gName = g.name;
          scheduleFileSave(gName, n.title, val);
        }
        return updated;
      })
    })));
  }, [scheduleFileSave]);

  const createNote = (groupId) => {
    const note = { id:uid(), title:"Untitled note", updated:fmtDate(), content:"# Untitled note\n\n" };
    const g = findGroup(groupId);
    setGroups(gs => gs.map(gr => gr.id === groupId ? { ...gr, notes:[note, ...gr.notes] } : gr));
    setExpanded(ex => ({ ...ex, [groupId]:true }));
    openNote(note.id, groupId);
    // Don't persist immediately - file will be created after first edit completion
    setTimeout(() => textareaRef.current?.focus(), 60);
  };

  const deleteNote = async (nid, gid) => {
    const n = findNote(nid);
    const g = findGroup(gid);
    if (n && g) await deleteNoteFile(g.name, n.title).catch(console.error);
    setGroups(gs => gs.map(g => g.id===gid ? { ...g, notes:g.notes.filter(n=>n.id!==nid) } : g));
    closeTab(nid);
  };

  const handleRename = async (nid, gid, oldTitle, newTitle) => {
    // Only rename file if title actually changed
    if (oldTitle !== newTitle && newTitle.trim()) {
      const g = findGroup(gid);
      if (g) {
        await renameNoteFile(g.name, oldTitle, newTitle).catch(console.error);
      }
    }
    // Update the title in state without triggering a file save
    setGroups(gs => gs.map(g => ({
      ...g,
      notes: g.notes.map(n => {
        if (n.id !== nid) return n;
        return { ...n, title: newTitle, updated: "today" };
      })
    })));
  };

  const addGroup = () => {
    if (!newGroupName.trim()) return;
    const palette = ["#534AB7","#1D9E75","#D85A30","#D4537E","#BA7517","#378ADD","#639922"];
    const g = { id:uid(), name:newGroupName.trim(), color:palette[groups.length % palette.length], notes:[] };
    setGroups(gs => [...gs, g]);
    setExpanded(ex => ({ ...ex, [g.id]:true }));
    setNewGroupEditing(false); setNewGroupName("");
  };

  const insertMarkdown = (before, after="") => {
    const ta = textareaRef.current;
    if (!ta || !currentNote) return;
    const { selectionStart:s, selectionEnd:e, value:v } = ta;
    const sel = v.slice(s, e);
    const nv = v.slice(0,s) + before + sel + after + v.slice(e);
    updateNote(activeNote, "content", nv);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s+before.length, s+before.length+sel.length); }, 0);
  };

  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key==="b") { e.preventDefault(); insertMarkdown("**","**"); }
      if (e.key==="i") { e.preventDefault(); insertMarkdown("*","*"); }
      if (e.key==="`") { e.preventDefault(); insertMarkdown("`","`"); }
      if (e.key==="k") { e.preventDefault(); insertMarkdown("[","](url)"); }
      if (e.key==="=") { e.preventDefault(); setFontSize(f => Math.min(f + 1, 24)); }
      if (e.key==="-") { e.preventDefault(); setFontSize(f => Math.max(f - 1, 10)); }
    }
    if (e.key==="Tab") {
      e.preventDefault();
      const ta=e.target, s=ta.selectionStart, v=ta.value;
      const nv = v.slice(0,s)+"  "+v.slice(s);
      updateNote(activeNote, "content", nv);
      setTimeout(()=>ta.setSelectionRange(s+2,s+2),0);
    }
  };

  const handlePreviewClick = (e) => {
    const cb = e.target.closest("input[type='checkbox']");
    if (!cb || !currentNote) return;
    const taskText = cb.dataset.task;
    if (!taskText) return;
    e.preventDefault();
    const lines = currentNote.content.split("\n");
    const newLines = lines.map(l => {
      // Task inside a list: `- [ ]` or `* [ ]`
      const prefix = l.match(/^[-*] \[[ x]\] /);
      if (prefix && l.slice(prefix[0].length) === taskText) {
        return l[3]==="x" ? l.replace("[x]", "[ ]") : l.replace("[ ]", "[x]");
      }
      // Standalone task: `[ ]` or `[x]` (no leading `- `)
      if (/^\[[ x]\] /.test(l) && l.slice(4) === taskText) {
        return l[1]==="x" ? l.replace("[x]", "[ ]") : l.replace("[ ]", "[x]");
      }
      return l;
    });
    updateNote(activeNote, "content", newLines.join("\n"));
  };

  return (
    <div style={{ fontFamily:"'JetBrains Mono','Fira Code','Cascadia Code',monospace", height:"100vh", display:"flex", flexDirection:"column", background:"#0f0f10", color:"#e2e0d8", overflow:"hidden" }}>
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box}
        html,body,#root{height:100%;overflow:hidden}
        body{background:#0f0f10}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:2px}
        ::-webkit-scrollbar-thumb:hover{background:#3a3a42}
        .nota-ta{resize:none;width:100%;height:100%;background:transparent;border:none;outline:none;color:#c8c6be;font-family:inherit;font-size:13.5px;line-height:1.9;caret-color:#7c6ff5}
        .nota-ta::placeholder{color:#3a3848}
        .nota-ta::selection{background:#534AB730}
        .nota-preview h1{font-size:1.5em;font-weight:500;color:#e8e6de;margin:0 0 1em;letter-spacing:-0.01em}
        .nota-preview h2{font-size:0.82em;font-weight:500;color:#6a6860;margin:1.4em 0 0.6em;text-transform:uppercase;letter-spacing:0.08em}
        .nota-preview h3{font-size:1.05em;font-weight:500;color:#c4c2ba;margin:1em 0 0.4em}
        .nota-preview p{color:#908e87;line-height:1.85;margin:0 0 0.7em}
        .nota-preview ul,.nota-preview ol{padding-left:1.5em;margin:0 0 0.7em}
        .nota-preview li{color:#908e87;line-height:1.85}
        .nota-preview .ic{background:#1c1c22;border:0.5px solid #2a2a34;border-radius:3px;padding:1px 6px;font-size:0.88em;color:#7c6ff5;font-family:inherit}
        .nota-preview .cb{background:#141416;border:0.5px solid #222230;border-radius:6px;padding:1em 1.1em;margin:0.8em 0;overflow-x:auto}
        .nota-preview .cb pre{font-family:inherit;font-size:0.92em;color:#7a7870;line-height:1.75;margin:0}
        .nota-preview .cl{font-size:0.75em;color:#6a6860;text-transform:uppercase;letter-spacing:0.08em;display:block;margin-bottom:0.4em}
        .nota-preview .nl{height:8px}
        .nota-preview blockquote{border-left:2px solid #534AB7;padding:0.15em 0 0.15em 1em;margin:0.8em 0;color:#5a5860}
        .nota-preview hr{border:none;border-top:0.5px solid #1e1e26;margin:1.4em 0}
        .nota-preview strong{color:#c8c6be;font-weight:500}
        .nota-preview em{color:#8a8880;font-style:italic}
        .nota-preview del{color:#5a5850;text-decoration:line-through}
        .nota-preview a{color:#7c6ff5;text-decoration:none}
        .nota-preview a:hover{text-decoration:underline}
        .nota-preview .task{display:flex;align-items:baseline;gap:8px;margin:4px 0;line-height:1.85}
        .nota-preview .task input[type="checkbox"]{accent-color:#534AB7;flex-shrink:0;cursor:pointer;margin:0}
        .nota-preview table{table-layout:fixed;border-collapse:collapse;border-spacing:0;border:1px solid #2a2a34;margin:0.8em 0;font-size:0.92em}
        .nota-preview th{background:#181820;color:#c4c2ba;font-weight:500;text-align:left;border:1px solid #2a2a34;padding:0.35em 0.85em}
        .nota-preview td{color:#908e87;border:1px solid #2a2a34;padding:0.35em 0.85em;vertical-align:top}
        .nota-preview tr{margin:0;padding:0}
        .nbtn{background:transparent;border:0.5px solid transparent;color:#444450;padding:3px 8px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11.5px;transition:all 0.12s;white-space:nowrap}
        .nbtn:hover{background:#181820;border-color:#2a2a34;color:#908e87}
        .nbtn.active{background:#1c1c28;border-color:#534AB770;color:#7c6ff5}
        .note-row{display:flex;flex-direction:column;padding:7px 10px 7px 16px;cursor:pointer;border-left:2px solid transparent;transition:background 0.1s}
        .note-row:hover{background:#141418}
        .note-row.active-note{background:#14141c;border-left-color:#534AB7}
        .tab-item{display:flex;align-items:center;gap:6px;padding:6px 12px;font-size:11px;cursor:pointer;border-right:0.5px solid #181820;color:#6a6860;white-space:nowrap;transition:all 0.1s;flex-shrink:0;user-select:none;letter-spacing:0.01em}
        .tab-item:hover{background:#141418;color:#6a6860}
        .tab-item.active-tab{background:#0f0f10;color:#c8c6be}
        .tab-x{opacity:0;font-size:10px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;border-radius:2px;transition:opacity 0.1s;color:#555}
        .tab-item:hover .tab-x,.tab-item.active-tab .tab-x{opacity:1}
        .tab-x:hover{background:#2a1a1a;color:#e24b4a}
        .grp-hdr{display:flex;align-items:center;gap:7px;padding:7px 10px;cursor:pointer;font-size:10px;color:#6a6860;text-transform:uppercase;letter-spacing:0.08em;font-weight:500;transition:color 0.1s;user-select:none}
        .grp-hdr:hover{color:#666660}
        .grp-add{opacity:0;transition:opacity 0.1s;font-size:15px;color:#383840;cursor:pointer;padding:0 2px;line-height:1}
        .grp-hdr:hover .grp-add{opacity:1}
        .grp-add:hover{color:#7c6ff5}
        .nota-input{background:#161620;border:0.5px solid #2a2a34;border-radius:4px;color:#c8c6be;font-family:inherit;font-size:12px;padding:5px 8px;outline:none;width:100%;transition:border-color 0.15s}
        .nota-input:focus{border-color:#534AB7}
        .ctx-menu{position:fixed;background:#18181e;border:0.5px solid #28283a;border-radius:6px;padding:4px;z-index:9999;min-width:150px;box-shadow:0 12px 32px #00000090}
        .ctx-item{padding:7px 12px;font-size:12px;color:#908e87;cursor:pointer;border-radius:3px;transition:background 0.1s;font-family:inherit}
        .ctx-item:hover{background:#222230}
        .ctx-item.danger{color:#6e4040}
        .ctx-item.danger:hover{background:#2a1818;color:#e24b4a}
        .toolbar-btn{background:transparent;border:0.5px solid transparent;color:#5a5868;padding:3px 7px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;transition:all 0.12s;line-height:1}
        .toolbar-btn:hover{background:#181820;border-color:#2a2a34;color:#7c6ff5}
        .title-inp{background:transparent;border:none;outline:none;color:#e4e2da;font-size:20px;font-weight:500;font-family:inherit;width:100%;letter-spacing:-0.01em;caret-color:#7c6ff5}
        .title-inp::placeholder{color:#3a3848}
        .search-inp{background:transparent;border:none;border-bottom:0.5px solid #161620;color:#908e87;font-family:inherit;font-size:12px;padding:8px 12px;width:100%;outline:none;transition:border-color 0.15s}
        .search-inp:focus{border-bottom-color:#534AB750}
        .search-inp::placeholder{color:#3a3848}
      `}</style>

      {/* ── titlebar ── */}
      <div style={{ display:"flex", alignItems:"center", background:"#09090b", borderBottom:"0.5px solid #161620", height:34, flexShrink:0, userSelect:"none", paddingRight:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:7, padding:"0 14px" }}>
          <div style={{ width:8, height:8, borderRadius:2, background:"#534AB7" }} />
          <span style={{ fontSize:11, color:"#6a6860", fontWeight:500, letterSpacing:"0.1em" }}>nota</span>
          <span style={{ fontSize:10, color:"#4a4858", marginLeft:4 }}>— {notesDir || "~/Documents/Nota"}</span>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:3, alignItems:"center" }}>
          <button className="nbtn" onClick={() => setSidebarOpen(o=>!o)} title="Toggle sidebar">
            {sidebarOpen ? "◫" : "▣"}
          </button>
          <div style={{ width:0.5, height:14, background:"#1e1e26", margin:"0 4px" }} />
          {["edit","split","preview"].map(m => (
            <button key={m} className={`nbtn ${mode===m?"active":""}`} onClick={() => setMode(m)}>{m}</button>
          ))}
          <div style={{ width:0.5, height:14, background:"#1e1e26", margin:"0 4px" }} />
          <button className="nbtn" onClick={() => setFontSize(f => Math.max(f - 1, 10))} title="Smaller font">−</button>
          <span style={{ fontSize:10, color:"#3a3848", minWidth:26, textAlign:"center" }}>{fontSize}</span>
          <button className="nbtn" onClick={() => setFontSize(f => Math.min(f + 1, 24))} title="Larger font">+</button>
        </div>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        {/* ── sidebar ── */}
        {sidebarOpen && (
          <div style={{ width:210, borderRight:"0.5px solid #161620", display:"flex", flexDirection:"column", background:"#09090b", flexShrink:0, overflow:"hidden" }}>
            <input className="search-inp" placeholder="search…" value={search} onChange={e=>setSearch(e.target.value)} />
            <div style={{ flex:1, overflowY:"auto", paddingBottom:12 }}>
              {filteredGroups.map(g => (
                <div key={g.id}>
                  <div className="grp-hdr" onClick={() => setExpanded(ex=>({...ex,[g.id]:!ex[g.id]}))}>
                    <span style={{ color:"#4a4858", fontSize:8 }}>{expanded[g.id]?"▾":"▸"}</span>
                    <GroupDot color={g.color} />
                    <span style={{ flex:1 }}>{g.name}</span>
                    <span className="grp-add" onClick={ev=>{ev.stopPropagation();createNote(g.id)}} title="New note">+</span>
                  </div>
                  {expanded[g.id] && g.notes.map(n => (
                    <NoteRow key={n.id} note={n} groupId={g.id}
                      active={activeNote===n.id}
                      onClick={() => openNote(n.id, g.id)}
                      onDelete={() => deleteNote(n.id, g.id)}
                      onRename={(newTitle) => handleRename(n.id, g.id, n.title, newTitle)}
                    />
                  ))}
                  {expanded[g.id] && g.notes.length===0 && (
                    <div style={{ padding:"3px 10px 3px 24px", fontSize:10.5, color:"#4a4858", fontStyle:"italic" }}>empty</div>
                  )}
                </div>
              ))}

              <div style={{ padding:"12px 10px 4px", borderTop:"0.5px solid #121216", marginTop:8 }}>
                {newGroupEditing ? (
                  <div style={{ display:"flex", gap:4 }}>
                    <input className="nota-input" placeholder="group name…" value={newGroupName}
                      onChange={e=>setNewGroupName(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")addGroup();if(e.key==="Escape"){setNewGroupEditing(false);setNewGroupName("")}}}
                      autoFocus />
                    <button className="nbtn" onClick={addGroup} style={{ flexShrink:0 }}>+</button>
                  </div>
                ) : (
                  <button className="nbtn" style={{ width:"100%", textAlign:"left", color:"#4a4858" }}
                    onClick={() => setNewGroupEditing(true)}>+ new group</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── main area ── */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {/* tabs */}
          <div style={{ display:"flex", alignItems:"stretch", background:"#09090b", borderBottom:"0.5px solid #161620", overflowX:"auto", flexShrink:0, minHeight:32 }}>
            {openTabs.map(t => {
              const n = findNote(t.noteId);
              const g = findGroup(t.groupId);
              if (!n) return null;
              return (
                <div key={t.noteId} className={`tab-item ${activeNote===t.noteId?"active-tab":""}`}
                  onClick={() => setActiveNote(t.noteId)}>
                  <GroupDot color={g?.color||"#888"} size={5} />
                  <span style={{ maxWidth:120, overflow:"hidden", textOverflow:"ellipsis" }}>{n.title}</span>
                  <span className="tab-x" onClick={e=>closeTab(t.noteId,e)}>✕</span>
                </div>
              );
            })}
            <div style={{ display:"flex", alignItems:"center", padding:"0 10px", cursor:"pointer", color:"#4a4858", fontSize:16, flexShrink:0, transition:"color 0.1s" }}
              onMouseEnter={e=>e.currentTarget.style.color="#7c6ff5"}
              onMouseLeave={e=>e.currentTarget.style.color="#4a4858"}
              onClick={() => createNote(groups[0]?.id)}>+</div>
          </div>

          {/* toolbar */}
          {currentNote && mode !== "preview" && (
            <div style={{ display:"flex", alignItems:"center", gap:2, padding:"4px 12px", borderBottom:"0.5px solid #121216", background:"#0c0c0e", flexShrink:0, flexWrap:"wrap" }}>
              {[
                ["B", () => insertMarkdown("**","**"), "bold"],
                ["I", () => insertMarkdown("*","*"), "italic"],
                ["~~", () => insertMarkdown("~~","~~"), "strikethrough"],
                null,
                ["H1", () => insertMarkdown("# "), "heading 1"],
                ["H2", () => insertMarkdown("## "), "heading 2"],
                null,
                ["—", () => insertMarkdown("\n---\n"), "divider"],
                ["- ", () => insertMarkdown("- "), "bullet"],
                ["1.", () => insertMarkdown("1. "), "ordered list"],
                ["[ ]", () => insertMarkdown("- [ ] "), "checkbox"],
                null,
                ["`…`", () => insertMarkdown("`","`"), "inline code"],
                ["```", () => insertMarkdown("\n```\n","\n```"), "code block"],
                null,
                ["[link]", () => insertMarkdown("[","](url)"), "link"],
                ["> ", () => insertMarkdown("> "), "quote"],
                null,
                ["⊞", () => insertMarkdown("\n| Header 1 | Header 2 |\n|----------|----------|\n| Cell A1  | Cell B1  |\n"), "table"],
              ].map((item, i) =>
                item === null
                  ? <div key={i} style={{ width:0.5, height:14, background:"#1e1e26", margin:"0 3px" }} />
                  : <button key={i} className="toolbar-btn" onClick={item[1]} title={item[2]}
                      style={{ fontStyle: item[0]==="I"?"italic":"normal", fontFamily: item[0].startsWith("`")||item[0]==="⊞"?"inherit":"inherit", fontSize: item[0]==="⊞"?"14px":"inherit" }}>
                      {item[0]}
                    </button>
              )}
            </div>
          )}

          {/* editor / preview */}
          {currentNote ? (
            <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
              {(mode==="edit"||mode==="split") && (
                <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", borderRight:mode==="split"?"0.5px solid #161620":"none" }}>
                  <div style={{ padding:"20px 28px 0", flexShrink:0 }}>
                    <input className="title-inp" style={{ fontSize: fontSize + 6 }} value={currentNote.title}
                      onFocus={() => setEditingTitleOriginal(currentNote.title)}
                      onChange={e => updateNote(activeNote,"title",e.target.value)}
                      onBlur={async (e) => {
                        // Rename file on blur if title changed
                        const newTitle = e.target.value;
                        const oldTitle = editingTitleOriginal ?? currentNote.title;
                        if (newTitle !== oldTitle && newTitle.trim() && currentGroup) {
                          await renameNoteFile(currentGroup.name, oldTitle, newTitle).catch(console.error);
                        }
                        setEditingTitleOriginal(null);
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          // Rename file on Enter if title changed
                          const newTitle = e.target.value;
                          const oldTitle = editingTitleOriginal ?? currentNote.title;
                          if (newTitle !== oldTitle && newTitle.trim() && currentGroup) {
                            await renameNoteFile(currentGroup.name, oldTitle, newTitle).catch(console.error);
                          }
                          e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                          // Revert to original title
                          if (editingTitleOriginal !== null) {
                            updateNote(activeNote, "title", editingTitleOriginal);
                          }
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="note title…" />
                    <div style={{ height:0.5, background:"#161620", margin:"12px 0" }} />
                  </div>
                  <div style={{ padding:"0 28px 20px", flex:1, overflow:"hidden", display:"flex" }}>
                    <textarea ref={textareaRef} className="nota-ta"
                      style={{ fontSize }}
                      value={currentNote.content}
                      onChange={e => updateNote(activeNote,"content",e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="start writing…  markdown supported" />
                  </div>
                </div>
              )}
              {(mode==="preview"||mode==="split") && (
                <div style={{ flex:1, overflow:"auto", padding:"20px 28px 40px" }}
                  onDoubleClick={() => { if (mode === "preview") setMode("edit"); }}>
                  <div className="nota-preview" style={{ fontSize }} onClick={handlePreviewClick}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(currentNote.content) }} />
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:14, color:"#1e1e26" }}>
              <div style={{ width:36, height:36, borderRadius:8, background:"#111116", border:"0.5px solid #1e1e26", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>✎</div>
              <span style={{ fontSize:12 }}>no note open</span>
              <button className="nbtn" onClick={() => createNote(groups[0]?.id)}>create a note</button>
            </div>
          )}
        </div>
      </div>

      {/* ── status bar ── */}
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"3px 14px", background:"#09090b", borderTop:"0.5px solid #161620", flexShrink:0, userSelect:"none" }}>
        {currentNote ? <>
          <span style={{ fontSize:10, color:"#4a4858" }}>{wordCount(currentNote.content)} words</span>
          <span style={{ fontSize:10, color:"#4a4858" }}>{currentNote.content.length} chars</span>
          <span style={{ fontSize:10, color:"#4a4858" }}>md</span>
          <span style={{ fontSize:10, color:"#3a3848" }}>Ctrl+B · Ctrl+I · Ctrl+` · Ctrl+K</span>
        </> : <span style={{ fontSize:10, color:"#3a3848" }}>nota</span>}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:6 }}>
          <div style={{ width:5, height:5, borderRadius:"50%", background: saveStatus==="saved" ? "#1D9E75" : "#BA7517" }} />
          <span style={{ fontSize:10, color:"#4a4858" }}>{saveStatus} · ~/Documents/Nota</span>
        </div>
      </div>
    </div>
  );
}

// ── NoteRow ───────────────────────────────────────────────────────────────────
function NoteRow({ note, active, onClick, onDelete, onRename }) {
  const [ctx, setCtx] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [val, setVal] = useState(note.title);

  useEffect(() => { setVal(note.title); }, [note.title]);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctx]);

  if (renaming) return (
    <div style={{ padding:"4px 10px 4px 14px" }}>
      <input className="nota-input" value={val} autoFocus
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key==="Enter") { onRename(val); setRenaming(false); }
          if (e.key==="Escape") { setRenaming(false); setVal(note.title); }
        }}
        onBlur={() => { onRename(val); setRenaming(false); }} />
    </div>
  );

  return (
    <>
      <div className={`note-row ${active?"active-note":""}`} onClick={onClick}
        onContextMenu={e=>{e.preventDefault();setCtx({x:e.clientX,y:e.clientY})}}>
        <span style={{ fontSize:12, fontWeight:active?500:400, color:active?"#b8b6ae":"#5a5858", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{note.title}</span>
        <span style={{ fontSize:10, color:"#4a4858", marginTop:1 }}>{note.updated}</span>
      </div>
      {ctx && (
        <div className="ctx-menu" style={{ left:ctx.x, top:ctx.y }}>
          <div className="ctx-item" onClick={()=>{setRenaming(true);setCtx(null)}}>Rename</div>
          <div className="ctx-item" onClick={()=>{navigator.clipboard?.writeText(note.content);setCtx(null)}}>Copy content</div>
          <div style={{ height:0.5, background:"#1e1e26", margin:"3px 0" }} />
          <div className="ctx-item danger" onClick={()=>{onDelete();setCtx(null)}}>Delete</div>
        </div>
      )}
    </>
  );
}
