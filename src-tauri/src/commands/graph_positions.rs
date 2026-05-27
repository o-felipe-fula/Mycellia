use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NodePosition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x2d: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y2d: Option<f32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x3d: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y3d: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z3d: Option<f32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<f32>,
}

fn get_positions_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    let mut path = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&path);
    path.push("graph_positions.json");
    Some(path)
}

#[tauri::command]
pub fn load_graph_positions<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> HashMap<String, NodePosition> {
    if let Some(path) = get_positions_path(&app) {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(positions) = serde_json::from_str::<HashMap<String, NodePosition>>(&content) {
                    return positions;
                }
            }
        }
    }
    HashMap::new()
}

#[tauri::command]
pub fn save_graph_positions<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    positions: HashMap<String, NodePosition>,
) -> Result<(), String> {
    if let Some(path) = get_positions_path(&app) {
        let content = serde_json::to_string(&positions)
            .map_err(|e| format!("Failed to serialize graph positions: {}", e))?;

        let temp_path = path.with_extension("tmp");
        let mut file = File::create(&temp_path)
            .map_err(|e| format!("Failed to create temp positions file: {}", e))?;

        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write temp positions file: {}", e))?;

        file.sync_all()
            .map_err(|e| format!("Failed to sync temp positions file: {}", e))?;

        drop(file);

        fs::rename(&temp_path, &path).map_err(|e| {
            format!(
                "Failed to overwrite positions file atomically (rename failed): {}",
                e
            )
        })?;

        Ok(())
    } else {
        Err("Failed to resolve config directory".to_string())
    }
}
