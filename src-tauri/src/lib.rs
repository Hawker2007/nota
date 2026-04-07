// src-tauri/src/lib.rs
// nota — Tauri v2 library
// handles: tray, global shortcuts, window show/hide, file I/O commands

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

// ── single-instance via named mutex (Windows) ────────────────────────────────

/// Returns `true` if this is the first (and only) instance.
pub fn is_single_instance() -> bool {
    #[cfg(windows)]
    unsafe {
        use std::os::windows::ffi::OsStrExt;

        use windows_sys::Win32::Foundation::{
            GetLastError, ERROR_ALREADY_EXISTS, HANDLE,
        };
        use windows_sys::Win32::System::Threading::CreateMutexW;

        let mutex_name: Vec<u16> = std::ffi::OsString::from("Local\\nota-single-instance-mutex")
            .encode_wide()
            .chain(Some(0))
            .collect();

        let handle: HANDLE = CreateMutexW(std::ptr::null(), 0, mutex_name.as_ptr());
        if handle == 0 {
            return true;
        }
        if GetLastError() == ERROR_ALREADY_EXISTS {
            return false;
        }
    }
    true
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn notes_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Nota")
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn get_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show_window(app: &AppHandle) {
    if let Some(win) = get_window(app) {
        win.show().ok();
        win.set_focus().ok();
        win.unminimize().ok();
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(win) = get_window(app) {
        let visible = win.is_visible().unwrap_or(false);
        let minimized = win.is_minimized().unwrap_or(false);
        if visible && !minimized {
            win.hide().ok();
        } else {
            show_window(app);
        }
    }
}

// ── file I/O commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_notes_dir(app: AppHandle) -> String {
    notes_dir(&app)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn save_note(
    app: AppHandle,
    group: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    let dir = notes_dir(&app).join(&group);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.md", sanitize(&filename)));
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(app: AppHandle, group: String, filename: String) -> Result<(), String> {
    let path = notes_dir(&app)
        .join(&group)
        .join(format!("{}.md", sanitize(&filename)));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn rename_note(
    app: AppHandle,
    group: String,
    old_filename: String,
    new_filename: String,
) -> Result<(), String> {
    let dir = notes_dir(&app).join(&group);
    let old = dir.join(format!("{}.md", sanitize(&old_filename)));
    let new = dir.join(format!("{}.md", sanitize(&new_filename)));
    
    // Only rename if old file exists and is different from new
    if old.exists() && old != new {
        fs::rename(&old, &new).map_err(|e| e.to_string())?;
    } else if !old.exists() {
        // Old file doesn't exist - this might be a new note that hasn't been saved yet
        // Just return Ok without error
    }
    Ok(())
}

#[tauri::command]
fn load_all_notes(app: AppHandle) -> Result<String, String> {
    let base = notes_dir(&app);
    let mut notes: Vec<serde_json::Value> = vec![];

    if !base.exists() {
        return Ok("[]".to_string());
    }

    for group_entry in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let group_entry = group_entry.map_err(|e| e.to_string())?;
        if !group_entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let group_name = group_entry.file_name().to_string_lossy().to_string();

        for note_entry in fs::read_dir(group_entry.path()).map_err(|e| e.to_string())? {
            let note_entry = note_entry.map_err(|e| e.to_string())?;
            let path = note_entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let title = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let content = fs::read_to_string(&path).unwrap_or_default();
            let meta = fs::metadata(&path).ok();
            let updated = meta
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let secs = t
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    let months = [
                        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct",
                        "Nov", "Dec",
                    ];
                    let year_day = ((secs / 86400) % 365) as usize;
                    let month_idx = (year_day / 30).min(11);
                    let day = (year_day % 30) + 1;
                    format!("{} {}", months[month_idx], day)
                })
                .unwrap_or_else(|| "—".to_string());

            notes.push(serde_json::json!({
                "group": group_name,
                "title": title,
                "content": content,
                "updated": updated,
            }));
        }
    }

    serde_json::to_string(&notes).map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(win) = get_window(&app) {
        win.hide().ok();
    }
}

// ── config ────────────────────────────────────────────────────────────────────

fn config_path(app: &AppHandle) -> PathBuf {
    notes_dir(app).join("config.md")
}

#[tauri::command]
fn save_config(app: AppHandle, content: String) -> Result<(), String> {
    let dir = notes_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = config_path(&app);
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<String, String> {
    let path = config_path(&app);
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok("{}".to_string())
    }
}

// ── tray ──────────────────────────────────────────────────────────────────────

fn setup_tray_menu(app: &AppHandle) {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let tray = app.tray_by_id("tray").expect("tray icon 'tray' not found");

    let show = MenuItem::with_id(app, "show", "Show/Hide  Ctrl+Shift+Space", true, None::<&str>).expect("menu item");
    let new_note = MenuItem::with_id(app, "new_note", "New note  Ctrl+Shift+N", true, None::<&str>).expect("menu item");
    let sep = PredefinedMenuItem::separator(app).expect("separator");
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).expect("menu item");
    let menu = Menu::with_items(app, &[&show, &new_note, &sep, &quit]).expect("menu");

    // Show menu only on right click (disable left-click menu)
    tray.set_menu(Some(menu)).expect("set menu");
    tray.set_show_menu_on_left_click(false).expect("set left click menu");

    tray.on_menu_event(|app, event| match event.id.as_ref() {
        "show" => toggle_window(app),
        "new_note" => {
            show_window(app);
            app.emit("new-note", ()).ok();
        }
        "quit" => std::process::exit(0),
        _ => {}
    });

    tray.on_tray_icon_event(|tray, event| {
        if let tauri::tray::TrayIconEvent::Click {
            button: tauri::tray::MouseButton::Left,
            button_state: tauri::tray::MouseButtonState::Up,
            ..
        } = event
        {
            toggle_window(&tray.app_handle());
        }
    });
}

// ── app builder ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            setup_tray_menu(app.handle());

            let app_handle = app.handle().clone();

            // Register global hotkey Ctrl+Shift+N → show + new note
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Modifiers};
            use keyboard_types::Code;

            let shortcut_n = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyN);
            app_handle
                .global_shortcut()
                .on_shortcut(shortcut_n, |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        show_window(_app);
                        _app.emit("new-note", ()).ok();
                    }
                })
                .unwrap_or_else(|e| eprintln!("Failed to register Ctrl+Shift+N: {}", e));

            // Register Ctrl+Shift+Space → toggle window
            let app_handle2 = app_handle.clone();
            let shortcut_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            app_handle
                .global_shortcut()
                .on_shortcut(shortcut_space, |_app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_window(_app);
                    }
                })
                .unwrap_or_else(|e| eprintln!("Failed to register Ctrl+Shift+Space: {}", e));

            // Ensure notes directory exists on first launch
            let base = notes_dir(&app_handle2);
            fs::create_dir_all(&base).ok();

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_notes_dir,
            save_note,
            delete_note,
            rename_note,
            load_all_notes,
            hide_window,
            save_config,
            load_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running nota");
}
