use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use tauri::AppHandle;
#[cfg(not(test))]
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub current_vault: Option<String>,
    pub recent_vaults: Vec<String>,
    pub theme: String,
    pub sidebar_width: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            current_vault: None,
            recent_vaults: Vec::new(),
            theme: "dark".to_string(), // default theme is Bioluminescent Dark
            sidebar_width: 260,
        }
    }
}

// Auxiliar para pegar o caminho do config.json no AppData
fn get_config_path<R: tauri::Runtime>(_app: &AppHandle<R>) -> Option<PathBuf> {
    #[cfg(test)]
    {
        let thread_id = format!("{:?}", std::thread::current().id())
            .replace("ThreadId(", "")
            .replace(")", "")
            .replace(" ", "");
        let path = std::env::temp_dir().join(format!("mycellia_test_config_{}", thread_id));
        let _ = fs::create_dir_all(&path);
        Some(path.join("config.json"))
    }
    #[cfg(not(test))]
    {
        let mut path = _app.path().app_config_dir().ok()?;
        // Garante que o diretório exista
        let _ = fs::create_dir_all(&path);
        path.push("config.json");
        Some(path)
    }
}

#[tauri::command]
pub fn load_config<R: tauri::Runtime>(app: AppHandle<R>) -> AppConfig {
    if let Some(path) = get_config_path(&app) {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return config;
                } else {
                    eprintln!("Warning: Failed to parse config.json, falling back to default.");
                }
            } else {
                eprintln!("Warning: Failed to read config.json, falling back to default.");
            }
        }
    }
    AppConfig::default()
}

#[tauri::command]
pub fn save_config<R: tauri::Runtime>(app: AppHandle<R>, config: AppConfig) -> Result<(), String> {
    if let Some(path) = get_config_path(&app) {
        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        // Escrita Atômica: grava em arquivo .tmp temporário, dá sync e renomeia
        let temp_path = path.with_extension("tmp");
        let mut file = File::create(&temp_path)
            .map_err(|e| format!("Failed to create temp config file: {}", e))?;

        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write temp config file: {}", e))?;

        file.sync_all()
            .map_err(|e| format!("Failed to sync temp config file: {}", e))?;

        drop(file);

        fs::rename(&temp_path, &path).map_err(|e| {
            format!(
                "Failed to overwrite config file atomically (rename failed): {}",
                e
            )
        })?;

        Ok(())
    } else {
        Err("Failed to resolve config directory".to_string())
    }
}

#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
pub fn get_rust_bootstrap_time() -> u64 {
    crate::RUST_START_INSTANT.get()
        .map(|t| t.elapsed().as_millis() as u64)
        .unwrap_or(0)
}
