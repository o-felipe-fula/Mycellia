// Prevents additional console window on Windows in release, do not remove!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::OnceLock;
use std::time::Instant;

pub static RUST_START_INSTANT: OnceLock<Instant> = OnceLock::new();

mod commands;

fn main() {
    RUST_START_INSTANT.set(Instant::now()).ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::index_db::DbState::default())
        .manage(commands::fs::WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            commands::config::load_config,
            commands::config::save_config,
            commands::config::get_platform,
            commands::config::get_rust_bootstrap_time,
            commands::fs::load_vault_tree,
            commands::fs::create_item,
            commands::fs::rename_item,
            commands::fs::move_item,
            commands::fs::delete_item,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::save_pasted_image,
            commands::fs::start_watching,
            commands::fs::stop_watching,
            commands::fs::open_in_default_app,
            commands::index_db::rebuild_index,
            commands::index_db::search_notes,
            commands::index_db::get_matching_paths,
            commands::index_db::get_indexing_status,
            commands::index_db::start_indexing_command,
            commands::index_db::get_all_notes,
            commands::index_db::get_backlinks,
            commands::index_db::get_graph_data,
            commands::graph_positions::load_graph_positions,
            commands::graph_positions::save_graph_positions,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let menu = tauri::menu::Menu::default(app.handle())?;
                app.set_menu(menu)?;
            }

            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
