// src-tauri/src/main.rs
// nota — Tauri v2 entry point (Windows subsystem)

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // If another instance is already running, activate its window and exit.
    if !app_lib::is_single_instance() {
        return;
    }

    app_lib::run();
}
