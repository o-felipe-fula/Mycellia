// Tripwire F0: barra unwrap/expect NOVO neste módulo de I/O (clippy::unwrap_used/expect_used).
// Sites existentes recebem #[allow] anotado com // TODO F1 (dívida a converter para Result no F1).
#![deny(clippy::unwrap_used, clippy::expect_used)]

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::{Manager, Emitter};

use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, FileIdMap};
use notify::{RecommendedWatcher, Watcher};
use sha2::{Sha256, Digest};

pub struct WriteRecord {
    pub hash: String,
    pub timestamp: Instant,
}

pub struct WatcherState {
    pub debouncer: Mutex<Option<Debouncer<RecommendedWatcher, FileIdMap>>>,
    pub last_written: Mutex<HashMap<String, WriteRecord>>, // path -> WriteRecord
    pub last_moved: Mutex<HashMap<String, Instant>>, // path -> Instant
}

impl Default for WatcherState {
    fn default() -> Self {
        Self {
            debouncer: Mutex::new(None),
            last_written: Mutex::new(HashMap::new()),
            last_moved: Mutex::new(HashMap::new()),
        }
    }
}

fn compute_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn canonicalize_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        path.to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let p = Path::new(path);
        if let Ok(canon) = std::fs::canonicalize(p) {
            canon.to_string_lossy().into_owned()
        } else {
            if let (Some(parent), Some(file_name)) = (p.parent(), p.file_name()) {
                if let Ok(canon_parent) = std::fs::canonicalize(parent) {
                    return canon_parent.join(file_name).to_string_lossy().into_owned();
                }
            }
            path.to_string()
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

// Lógica de leitura recursiva e ordenação (pastas primeiro, depois arquivos alfabeticamente)
struct SortNode {
    node: FileNode,
    lower_name: String,
}

fn read_dir_recursive(path: &Path) -> Result<Vec<FileNode>, std::io::Error> {
    let mut items = Vec::new();
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let path_buf = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();

            // Ignorar arquivos e pastas ocultos (.git, .trash, etc)
            if name.starts_with('.') {
                continue;
            }

            // Otimização: obter tipo diretamente do DirEntry evita syscalls de metadados extras de disco
            let is_dir = entry.file_type()?.is_dir();
            let children = if is_dir {
                Some(read_dir_recursive(&path_buf)?)
            } else {
                None
            };

            let lower_name = name.to_lowercase();
            items.push(SortNode {
                node: FileNode {
                    name,
                    path: path_buf.to_string_lossy().into_owned(),
                    is_dir,
                    children,
                },
                lower_name,
            });
        }
    }

    // Ordenação: Diretórios primeiro, depois arquivos alfabeticamente de forma case-insensitive.
    // Otimização: pré-computar a string minúscula reduz alocações para N em vez de N log N no laço de ordenação.
    items.sort_by(|a, b| {
        if a.node.is_dir != b.node.is_dir {
            b.node.is_dir.cmp(&a.node.is_dir) // true (is_dir) vem antes de false
        } else {
            a.lower_name.cmp(&b.lower_name)
        }
    });

    Ok(items.into_iter().map(|s| s.node).collect())
}

// Função auxiliar interna para carregar a árvore recursivamente
pub fn load_vault_tree_internal(vault_path: String) -> Result<FileNode, String> {
    let start_time = Instant::now();
    let root_path = Path::new(&vault_path);

    if !root_path.exists() || !root_path.is_dir() {
        return Err("Diretório do vault inválido ou inexistente".to_string());
    }

    let root_name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| vault_path.clone());

    let children = read_dir_recursive(root_path)
        .map_err(|e| format!("Falha ao ler diretório do vault: {}", e))?;

    let duration = start_time.elapsed();
    println!(
        "load_vault_tree performance check: mapped {} in {:?}",
        root_name, duration
    );

    Ok(FileNode {
        name: root_name,
        path: vault_path,
        is_dir: true,
        children: Some(children),
    })
}

// Carregar toda a árvore com telemetria e concessão dinâmica do escopo do asset protocol
#[tauri::command]
pub fn load_vault_tree(app: tauri::AppHandle, vault_path: String) -> Result<FileNode, String> {
    let root_path = Path::new(&vault_path);
    if root_path.exists() && root_path.is_dir() {
        // Conceder escopo do asset protocol dinamicamente ao vault e subdiretórios
        if let Err(e) = app.asset_protocol_scope().allow_directory(root_path, true) {
            eprintln!("Warning: Falha ao conceder escopo do asset protocol para {:?}: {}", root_path, e);
        }
    }
    load_vault_tree_internal(vault_path)
}

// Resolve colisões de nomes adicionando sufixo incremental ("Sem título.md" -> "Sem título 1.md")
fn resolve_unique_path(parent: &Path, name: &str, is_dir: bool) -> PathBuf {
    let mut base_name = name.to_string();
    let mut ext = "";

    if !is_dir {
        if let Some(pos) = name.rfind('.') {
            base_name = name[..pos].to_string();
            ext = &name[pos..];
        } else {
            ext = ".md"; // Markdown por padrão
        }
    }

    let mut attempt = 0;
    loop {
        let current_name = if attempt == 0 {
            format!("{}{}", base_name, ext)
        } else {
            format!("{} {}{}", base_name, attempt, ext)
        };

        let full_path = parent.join(&current_name);
        if !full_path.exists() {
            return full_path;
        }
        attempt += 1;
    }
}

#[tauri::command]
pub fn create_item(parent_path: String, name: String, is_dir: bool) -> Result<String, String> {
    let parent = Path::new(&parent_path);
    if !parent.exists() || !parent.is_dir() {
        return Err("Diretório pai inválido ou inexistente".to_string());
    }

    let final_path = resolve_unique_path(parent, &name, is_dir);

    if is_dir {
        fs::create_dir_all(&final_path).map_err(|e| format!("Falha ao criar diretório: {}", e))?;
    } else {
        // Garante que o arquivo de destino seja criado vazio
        fs::write(&final_path, b"").map_err(|e| format!("Falha ao criar arquivo: {}", e))?;
    }

    Ok(final_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn rename_item(path: String, new_name: String) -> Result<String, String> {
    let current_path = Path::new(&path);
    if !current_path.exists() {
        return Err("Arquivo ou pasta de origem não existe".to_string());
    }

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("O nome do arquivo não pode ser vazio".to_string());
    }

    let invalid_chars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
    if trimmed.chars().any(|c| invalid_chars.contains(&c)) {
        return Err("O nome do arquivo contém caracteres inválidos. Não use: \\ / : * ? \" < > |".to_string());
    }

    let parent = current_path
        .parent()
        .ok_or_else(|| "Não foi possível resolver o diretório pai".to_string())?;

    let mut final_new_name = trimmed.to_string();
    // Preserva a extensão se o usuário digitou sem extensão e a origem é um arquivo
    if current_path.is_file() && !trimmed.contains('.') {
        if let Some(ext) = current_path.extension() {
            final_new_name = format!("{}.{}", trimmed, ext.to_string_lossy());
        }
    }

    let target_path = parent.join(&final_new_name);

    if target_path.exists() {
        return Err("Já existe um arquivo ou pasta com este nome".to_string());
    }

    fs::rename(current_path, &target_path).map_err(|e| format!("Falha ao renomear item: {}", e))?;

    Ok(target_path.to_string_lossy().into_owned())
}

fn get_mtime(p: &Path) -> i64 {
    if let Ok(metadata) = std::fs::metadata(p) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                return duration.as_secs() as i64;
            }
        }
    }
    0
}

fn get_all_md_files(dir: &Path, files: &mut Vec<PathBuf>) {
    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    get_all_md_files(&path, files);
                } else if path.is_file() {
                    if let Some(ext) = path.extension() {
                        if ext == "md" {
                            files.push(path);
                        }
                    }
                }
            }
        }
    }
}

pub fn move_item_internal(path: String, new_parent_path: String) -> Result<String, String> {
    let current_path = Path::new(&path);
    if !current_path.exists() {
        return Err("Arquivo ou pasta de origem não existe".to_string());
    }

    let file_name = current_path
        .file_name()
        .ok_or_else(|| "Não foi possível obter o nome do item".to_string())?;

    let dest_parent = Path::new(&new_parent_path);
    if !dest_parent.exists() || !dest_parent.is_dir() {
        return Err("Diretório de destino inválido ou inexistente".to_string());
    }

    let dest_path = dest_parent.join(file_name);

    if dest_path.exists() {
        return Err(
            "Já existe um arquivo ou pasta com este nome no diretório de destino".to_string(),
        );
    }

    // Anti-loop safety check: prevent moving a directory into itself or its subdirectories
    if current_path.is_dir() && dest_path.starts_with(current_path) {
        return Err("Não é possível mover uma pasta para dentro de si mesma ou de seus subdiretórios".to_string());
    }

    fs::rename(current_path, &dest_path).map_err(|e| format!("Falha ao mover item: {}", e))?;

    Ok(dest_path.to_string_lossy().into_owned())
}

#[allow(clippy::unwrap_used, clippy::expect_used)] // TODO F1: converter para Result
#[tauri::command]
pub fn move_item<R: tauri::Runtime>(app: tauri::AppHandle<R>, path: String, new_parent_path: String) -> Result<String, String> {
    // 1. Resolver o caminho canônico do arquivo de origem ANTES de mover (ele ainda existe)
    let canon_src = canonicalize_path(&path);

    // 2. Chamar a interna pura para mover fisicamente no disco
    let new_path = move_item_internal(path.clone(), new_parent_path)?;

    // 3. Resolver o caminho canônico do destino (que já foi criado)
    let canon_dest = canonicalize_path(&new_path);

    // 4. Registrar no WatcherState para suprimir eco no watcher com caminhos canônicos
    if let Some(state) = app.try_state::<WatcherState>() {
        let mut last_moved = state.last_moved.lock().unwrap();
        let now = Instant::now();
        last_moved.insert(canon_src.clone(), now);
        last_moved.insert(canon_dest.clone(), now);
    }

    // 5. Atualizar o índice SQLite diretamente usando caminhos canônicos para consistência
    let db_state = app.state::<crate::commands::index_db::DbState>();
    let mut conn_lock = db_state.conn.lock().map_err(|e| e.to_string())?;
    if conn_lock.is_none() {
        return Err("Banco de dados não inicializado".to_string());
    }
    let conn = conn_lock.as_mut().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let source_path = Path::new(&canon_src);
    let target_path = Path::new(&canon_dest);

    if target_path.is_file() {
        // Excluir a nota antiga
        crate::commands::index_db::delete_file_in_tx(&tx, &canon_src)?;
        
        // Obter mtime e indexar nova nota
        let mtime = get_mtime(target_path);
        crate::commands::index_db::index_single_file_in_tx(&tx, target_path, mtime)?;
    } else {
        // É um diretório. Recursivamente encontrar e reindexar todas as notas .md dele.
        let mut md_files = Vec::new();
        get_all_md_files(target_path, &mut md_files);
        
        for md_file in md_files {
            // Computa o caminho antigo correspondente de forma resiliente para Windows (Correction #2)
            if let Ok(rel) = md_file.strip_prefix(target_path) {
                let old_md_path = source_path.join(rel);
                let old_md_str = old_md_path.to_string_lossy().into_owned();
                
                // Excluir a nota antiga
                crate::commands::index_db::delete_file_in_tx(&tx, &old_md_str)?;
                
                // Indexar nova nota no índice
                let mtime = get_mtime(&md_file);
                crate::commands::index_db::index_single_file_in_tx(&tx, &md_file, mtime)?;
            }
        }
    }

    // Re-resolver links usando o caminho do vault também canonicalizado para manter integridade
    let config = crate::commands::config::load_config(app.clone());
    if let Some(vault_path) = config.current_vault {
        let canon_vault = canonicalize_path(&vault_path);
        crate::commands::index_db::re_resolve_all_links(&tx, &canon_vault).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(canon_dest)
}

#[tauri::command]
pub fn delete_item(path: String) -> Result<(), String> {
    let target_path = Path::new(&path);
    if !target_path.exists() {
        return Err("O arquivo ou pasta a ser excluído não existe".to_string());
    }

    trash::delete(target_path).map_err(|e| format!("Falha ao mover item para a lixeira: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let file_path = Path::new(&path);
    if !file_path.exists() || !file_path.is_file() {
        return Err("O arquivo não existe ou é inválido".to_string());
    }
    fs::read_to_string(file_path).map_err(|e| format!("Falha ao ler arquivo: {}", e))
}

fn write_file_internal(path: &str, content: &str, allow_create: bool) -> Result<(), String> {
    use std::io::Write;
    let file_path = Path::new(path);
    if !allow_create && !file_path.exists() {
        return Err("O arquivo de destino não existe".to_string());
    }

    // Escrita Atômica: grava em arquivo .tmp temporário, dá sync e renomeia
    let temp_path = file_path.with_extension("tmp");
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Falha ao criar arquivo temporário: {}", e))?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("Falha ao escrever no arquivo temporário: {}", e))?;

    file.sync_all()
        .map_err(|e| format!("Falha ao sincronizar arquivo temporário: {}", e))?;

    drop(file);

    fs::rename(&temp_path, file_path).map_err(|e| {
        format!(
            "Falha ao substituir arquivo de forma atômica (rename falhou): {}",
            e
        )
    })?;

    Ok(())
}

#[allow(clippy::unwrap_used, clippy::expect_used)] // TODO F1: converter para Result
#[tauri::command]
pub fn write_file<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
    content: String,
    allow_create: bool,
) -> Result<(), String> {
    let hash = compute_hash(&content);
    if let Some(state) = app.try_state::<WatcherState>() {
        let mut last_written = state.last_written.lock().unwrap();
        let canon_path = canonicalize_path(&path);
        last_written.insert(canon_path, WriteRecord {
            hash,
            timestamp: Instant::now(),
        });
    }
    write_file_internal(&path, &content, allow_create)
}

#[allow(clippy::unwrap_used, clippy::expect_used)] // TODO F1: converter para Result
#[tauri::command]
pub fn start_watching<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, WatcherState>,
    vault_path: String,
) -> Result<(), String> {
    let _ = stop_watching(state.clone());

    let canon_vault_path = canonicalize_path(&vault_path);
    let app_clone = app.clone();
    let vault_path_clone = canon_vault_path.clone();

    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(100),
        None,
        move |res| {
            if let Ok(events) = res {
                let _ = handle_watcher_events(&app_clone, &vault_path_clone, events);
            }
        }
    ).map_err(|e| format!("Falha ao criar watcher: {}", e))?;

    debouncer.watcher()
        .watch(Path::new(&canon_vault_path), notify::RecursiveMode::Recursive)
        .map_err(|e| format!("Falha ao registrar caminho no watcher: {}", e))?;

    let mut debouncer_lock = state.debouncer.lock().unwrap();
    *debouncer_lock = Some(debouncer);

    Ok(())
}

#[allow(clippy::unwrap_used, clippy::expect_used)] // TODO F1: converter para Result
#[tauri::command]
pub fn stop_watching(
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    let mut debouncer_lock = state.debouncer.lock().unwrap();
    if let Some(debouncer) = debouncer_lock.take() {
        drop(debouncer);
    }
    Ok(())
}

#[tauri::command]
pub fn open_in_default_app<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let config = crate::commands::config::load_config(app.clone());
    let vault_path = config.current_vault.ok_or_else(|| "Nenhum vault ativo".to_string())?;

    // Resolver caminhos absolutos e canonicalizar para evitar bypass de travessia (ex: ../)
    let vault_root = std::fs::canonicalize(Path::new(&vault_path))
        .map_err(|e| format!("Falha ao resolver caminho do vault: {}", e))?;
    let target_path = std::fs::canonicalize(Path::new(&path))
        .map_err(|e| format!("Falha ao resolver caminho do arquivo: {}", e))?;

    // Garantir contenção de caminho
    if !target_path.starts_with(&vault_root) {
        return Err("Acesso negado: o arquivo está fora do vault ativo".to_string());
    }

    // Evitar abertura de arquivos Markdown (case-insensitive)
    if let Some(ext) = target_path.extension().and_then(|e| e.to_str()) {
        if ext.eq_ignore_ascii_case("md") {
            return Err("Arquivos Markdown não podem ser abertos no aplicativo padrão".to_string());
        }
    }

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(target_path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultChange {
    pub path: String,
    #[serde(rename = "changeType")]
    pub change_type: String,
    #[serde(rename = "isEcho")]
    pub is_echo: bool,
}

#[allow(clippy::unwrap_used, clippy::expect_used)] // TODO F1: converter para Result
fn handle_watcher_events<R: tauri::Runtime>(app: &tauri::AppHandle<R>, vault_path: &str, events: Vec<DebouncedEvent>) -> Result<(), String> {
    use std::collections::HashSet;
    
    let mut paths_to_delete = HashSet::new();
    let mut paths_to_index = HashSet::new();
    
    for event in events {
        match event.event.kind {
            notify::EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::Both)) => {
                if event.event.paths.len() >= 2 {
                    let from_path = canonicalize_path(&event.event.paths[0].to_string_lossy());
                    let to_path = canonicalize_path(&event.event.paths[1].to_string_lossy());
                    if !from_path.ends_with(".tmp") {
                        paths_to_delete.insert(from_path);
                    }
                    if to_path.ends_with(".md") && !to_path.ends_with(".tmp") {
                        paths_to_index.insert(to_path);
                    }
                } else if !event.event.paths.is_empty() {
                    let path = canonicalize_path(&event.event.paths[0].to_string_lossy());
                    if !path.ends_with(".tmp") {
                        if Path::new(&path).exists() {
                            if path.ends_with(".md") {
                                paths_to_index.insert(path);
                            }
                        } else {
                            paths_to_delete.insert(path);
                        }
                    }
                }
            }
            notify::EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::From)) |
            notify::EventKind::Remove(_) => {
                for p in event.event.paths {
                    let path_str = canonicalize_path(&p.to_string_lossy());
                    if !path_str.ends_with(".tmp") {
                        paths_to_delete.insert(path_str);
                    }
                }
            }
            notify::EventKind::Modify(notify::event::ModifyKind::Name(notify::event::RenameMode::To)) |
            notify::EventKind::Create(_) |
            notify::EventKind::Modify(_) => {
                for p in event.event.paths {
                    let path_str = canonicalize_path(&p.to_string_lossy());
                    if path_str.ends_with(".md") && !path_str.ends_with(".tmp") && p.is_file() {
                        paths_to_index.insert(path_str);
                    }
                }
            }
            _ => {
                for p in event.event.paths {
                    let path_str = canonicalize_path(&p.to_string_lossy());
                    if path_str.ends_with(".md") && !path_str.ends_with(".tmp") {
                        if p.exists() && p.is_file() {
                            paths_to_index.insert(path_str);
                        } else {
                            paths_to_delete.insert(path_str);
                        }
                    }
                }
            }
        }
    }
    
    if paths_to_delete.is_empty() && paths_to_index.is_empty() {
        return Ok(());
    }
    
    let db_state = app.state::<crate::commands::index_db::DbState>();
    let mut conn_lock = db_state.conn.lock().map_err(|e| e.to_string())?;
    if conn_lock.is_none() {
        return Err("Database connection not initialized".to_string());
    }
    let conn = conn_lock.as_mut().unwrap();
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let watcher_state = app.state::<WatcherState>();

    // 1. Limpar registros expirados de last_written e last_moved (mais velhos que 1000ms)
    {
        let mut last_written = watcher_state.last_written.lock().unwrap();
        let now = Instant::now();
        last_written.retain(|_, record| {
            now.duration_since(record.timestamp) < std::time::Duration::from_millis(1000)
        });
    }
    {
        let mut last_moved = watcher_state.last_moved.lock().unwrap();
        let now = Instant::now();
        last_moved.retain(|_, timestamp| {
            now.duration_since(*timestamp) < std::time::Duration::from_millis(1000)
        });
    }
    
    let is_move_echo = |path: &str| -> bool {
        let last_moved = watcher_state.last_moved.lock().unwrap();
        let now = Instant::now();
        
        last_moved.iter().any(|(moved_path, timestamp)| {
            if now.duration_since(*timestamp) < std::time::Duration::from_millis(1000) {
                #[cfg(target_os = "windows")]
                {
                    let path_lower = path.to_lowercase().replace('/', "\\");
                    let moved_lower = moved_path.to_lowercase().replace('/', "\\");
                    let path_norm = Path::new(&path_lower);
                    let moved_norm = Path::new(&moved_lower);
                    path_norm == moved_norm || path_norm.starts_with(moved_norm)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let path_buf = Path::new(path);
                    let moved_buf = Path::new(moved_path);
                    path_buf == moved_buf || path_buf.starts_with(moved_buf)
                }
            } else {
                false
            }
        })
    };
    
    let mut changes = Vec::new();
    
    // 2. Processar remoções e suprimir ecos de deleção transitória
    for path in paths_to_delete {
        if is_move_echo(&path) {
            println!("Echo suppression: completely ignored delete event for {} (internal move)", path);
            continue;
        }

        let is_echo_delete = {
            let last_written = watcher_state.last_written.lock().unwrap();
            if let Some(record) = last_written.get(&path) {
                if Instant::now().duration_since(record.timestamp) < std::time::Duration::from_millis(1000) {
                    let p = Path::new(&path);
                    if p.exists() && p.is_file() {
                        if let Ok(content) = std::fs::read_to_string(p) {
                            let hash = compute_hash(&content);
                            hash == record.hash
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            }
        };

        if is_echo_delete {
            println!("Echo suppression: suppressed delete event for {}", path);
            continue;
        }

        let exists_in_db: bool = tx.query_row(
            "SELECT 1 FROM notes WHERE path = ?",
            [&path],
            |_| Ok(true)
        ).unwrap_or(false);
        
        if exists_in_db {
            crate::commands::index_db::delete_file_in_tx(&tx, &path)?;
            changes.push(VaultChange {
                path: path.clone(),
                change_type: "delete".to_string(),
                is_echo: false,
            });
        }
    }
    
    // 3. Processar indexação de novos/modificados
    for path in paths_to_index {
        if is_move_echo(&path) {
            println!("Echo suppression: completely ignored index event for {} (internal move)", path);
            continue;
        }

        let p = Path::new(&path);
        if !p.exists() || !p.is_file() {
            continue;
        }
        
        let content = match std::fs::read_to_string(p) {
            Ok(c) => c,
            Err(_) => continue,
        };
        
        let hash = compute_hash(&content);
        
        let is_echo = {
            let last_written = watcher_state.last_written.lock().unwrap();
            if let Some(record) = last_written.get(&path) {
                Instant::now().duration_since(record.timestamp) < std::time::Duration::from_millis(1000) && record.hash == hash
            } else {
                false
            }
        };
        
        let exists_in_db: bool = tx.query_row(
            "SELECT 1 FROM notes WHERE path = ?",
            [&path],
            |_| Ok(true)
        ).unwrap_or(false);
        
        let mtime = if let Ok(metadata) = std::fs::metadata(p) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                    duration.as_secs() as i64
                } else {
                    0
                }
            } else {
                0
            }
        } else {
            0
        };
        
        crate::commands::index_db::index_single_file_in_tx(&tx, p, mtime)?;
        
        changes.push(VaultChange {
            path: path.clone(),
            change_type: if exists_in_db { "modify".to_string() } else { "create".to_string() },
            is_echo,
        });
    }
    
    crate::commands::index_db::re_resolve_all_links(&tx, vault_path).map_err(|e| e.to_string())?;
    
    tx.commit().map_err(|e| e.to_string())?;
    
    if !changes.is_empty() {
        app.emit("vault-change", changes).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

fn format_timestamp_utc(secs: u64) -> String {
    let days = secs / 86400;
    let seconds_in_day = secs % 86400;
    
    let mut year = 1970;
    let mut days_left = days;
    
    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if days_left < days_in_year {
            break;
        }
        days_left -= days_in_year;
        year += 1;
    }
    
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let mut month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if is_leap {
        month_days[1] = 29;
    }
    
    let mut month = 1;
    for &md in &month_days {
        if days_left < md as u64 {
            break;
        }
        days_left -= md as u64;
        month += 1;
    }
    
    let day = days_left + 1;
    let hour = seconds_in_day / 3600;
    let minute = (seconds_in_day % 3600) / 60;
    let second = seconds_in_day % 60;
    
    format!("{:04}{:02}{:02}{:02}{:02}{:02}", year, month, day, hour, minute, second)
}

#[allow(clippy::unwrap_used, clippy::expect_used)] // TODO F1: converter para Result
#[tauri::command]
pub fn save_pasted_image<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    base64_data: String,
    extension: String,
) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    use std::io::Write;

    let config = crate::commands::config::load_config(app.clone());
    let vault_root_str = config.current_vault.ok_or_else(|| "Nenhum vault ativo".to_string())?;
    let vault_root = Path::new(&vault_root_str);

    let canonical_vault_root = fs::canonicalize(vault_root)
        .map_err(|e| format!("Falha ao resolver caminho do vault: {}", e))?;

    let attachments_dir = vault_root.join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|e| format!("Falha ao criar diretório attachments: {}", e))?;

    let canonical_attachments_dir = fs::canonicalize(&attachments_dir)
        .map_err(|e| format!("Falha ao resolver attachments: {}", e))?;

    if !canonical_attachments_dir.starts_with(&canonical_vault_root) {
        return Err("Acesso negado: attachments fora da raiz do vault".to_string());
    }

    let now = std::time::SystemTime::now();
    let since_the_epoch = now.duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Falha ao obter tempo do sistema: {}", e))?;
    let timestamp_secs = since_the_epoch.as_secs();

    let base_name = format!("Pasted image {}", format_timestamp_utc(timestamp_secs));
    let mut file_name = format!("{}.{}", base_name, extension);
    let mut target_path = attachments_dir.join(&file_name);

    let mut counter = 1;
    while target_path.exists() {
        file_name = format!("{}_{}.{}", base_name, counter, extension);
        target_path = attachments_dir.join(&file_name);
        counter += 1;
    }

    if !target_path.starts_with(&attachments_dir) {
        return Err("Acesso negado: tentativa de escape de diretório".to_string());
    }

    let decoded_bytes = general_purpose::STANDARD.decode(&base64_data)
        .map_err(|e| format!("Falha ao decodificar base64: {}", e))?;

    let temp_path = target_path.with_extension("tmp");
    let mut file = fs::File::create(&temp_path)
        .map_err(|e| format!("Falha ao criar arquivo temporário: {}", e))?;

    file.write_all(&decoded_bytes)
        .map_err(|e| format!("Falha ao escrever no arquivo temporário: {}", e))?;

    file.sync_all()
        .map_err(|e| format!("Falha ao sincronizar arquivo temporário: {}", e))?;

    drop(file);

    fs::rename(&temp_path, &target_path)
        .map_err(|e| format!("Falha ao substituir arquivo de forma atômica: {}", e))?;

    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(&decoded_bytes);
        format!("{:x}", hasher.finalize())
    };

    let path_str = target_path.to_string_lossy().into_owned();
    if let Some(state) = app.try_state::<WatcherState>() {
        let mut last_written = state.last_written.lock().unwrap();
        let canon_path = canonicalize_path(&path_str);
        last_written.insert(canon_path, WriteRecord {
            hash,
            timestamp: Instant::now(),
        });
    }

    Ok(file_name)
}


#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use tauri::Listener;

    #[test]
    fn test_read_write_file_atomic() {
        let temp_dir = env::temp_dir().join("mycellia_file_tests");
        let _ = fs::create_dir_all(&temp_dir);

        let file_path = temp_dir.join("test_note.md");
        // Cria o arquivo inicial
        fs::write(&file_path, b"Initial content").unwrap();

        // Testa leitura
        let content = read_file(file_path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(content, "Initial content");

        // Testa escrita atômica
        write_file_internal(
            &file_path.to_string_lossy(),
            "New content",
            false,
        )
        .unwrap();

        // Verifica o conteúdo escrito
        let content_after = read_file(file_path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(content_after, "New content");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_resolve_unique_path() {
        let temp_dir = env::temp_dir().join("mycellia_tests");
        let _ = fs::create_dir_all(&temp_dir);

        let file_name = "Nota.md";
        let unique_path = resolve_unique_path(&temp_dir, file_name, false);
        assert_eq!(
            unique_path.file_name().unwrap().to_str().unwrap(),
            "Nota.md"
        );

        // Criar o arquivo para provocar colisão
        fs::write(&unique_path, b"").unwrap();

        let unique_path_2 = resolve_unique_path(&temp_dir, file_name, false);
        assert_eq!(
            unique_path_2.file_name().unwrap().to_str().unwrap(),
            "Nota 1.md"
        );

        // Criar a colisão secundária
        fs::write(&unique_path_2, b"").unwrap();

        let unique_path_3 = resolve_unique_path(&temp_dir, file_name, false);
        assert_eq!(
            unique_path_3.file_name().unwrap().to_str().unwrap(),
            "Nota 2.md"
        );

        // Limpeza dos arquivos temporários de teste
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rename_item_validations() {
        let temp_dir = env::temp_dir().join("mycellia_rename_tests");
        let _ = fs::create_dir_all(&temp_dir);

        let note_a_path = temp_dir.join("nota_original.md");
        let note_b_path = temp_dir.join("nota_colisao.md");

        let content_a = b"Original note content X";
        let content_b = b"Collision target content Y";

        fs::write(&note_a_path, content_a).unwrap();
        fs::write(&note_b_path, content_b).unwrap();

        // 1. Test collision
        let res_collision = rename_item(
            note_a_path.to_string_lossy().into_owned(),
            "nota_colisao".to_string(),
        );
        assert!(res_collision.is_err());
        assert_eq!(
            res_collision.unwrap_err(),
            "Já existe um arquivo ou pasta com este nome"
        );

        // Assert that both files remain byte-by-byte identical (unaffected by collision attempt)
        let data_a = fs::read(&note_a_path).unwrap();
        let data_b = fs::read(&note_b_path).unwrap();
        assert_eq!(data_a, content_a);
        assert_eq!(data_b, content_b);

        // 2. Test empty name
        let res_empty = rename_item(
            note_a_path.to_string_lossy().into_owned(),
            "   ".to_string(),
        );
        assert!(res_empty.is_err());
        assert_eq!(
            res_empty.unwrap_err(),
            "O nome do arquivo não pode ser vazio"
        );
        assert_eq!(fs::read(&note_a_path).unwrap(), content_a);

        // 3. Test invalid characters
        let res_invalid = rename_item(
            note_a_path.to_string_lossy().into_owned(),
            "nota*invalida".to_string(),
        );
        assert!(res_invalid.is_err());
        assert!(res_invalid.unwrap_err().contains("O nome do arquivo contém caracteres inválidos"));
        assert_eq!(fs::read(&note_a_path).unwrap(), content_a);

        // 4. Test success rename
        let res_success = rename_item(
            note_a_path.to_string_lossy().into_owned(),
            "nota_nova".to_string(),
        );
        assert!(res_success.is_ok());
        let expected_new_path = temp_dir.join("nota_nova.md");
        assert_eq!(res_success.unwrap(), expected_new_path.to_string_lossy().into_owned());

        // Assert new file exists with content A and old file does not exist
        assert!(!note_a_path.exists());
        assert!(expected_new_path.exists());
        assert_eq!(fs::read(&expected_new_path).unwrap(), content_a);

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn benchmark_load_vault_tree_large() {
        let temp_dir = env::temp_dir().join("mycellia_perf_test");
        let _ = fs::create_dir_all(&temp_dir);

        // Gera 128 pastas e 4782 arquivos Markdown para replicar o vault real do Felipe
        let folders_count = 128;
        let files_count = 4782;

        let mut folders = Vec::new();
        for i in 0..folders_count {
            let folder_path = temp_dir.join(format!("Folder_{}", i));
            fs::create_dir_all(&folder_path).unwrap();
            folders.push(folder_path);
        }

        for i in 0..files_count {
            let parent_folder = &folders[i % folders_count];
            let file_path = parent_folder.join(format!("Note_{}.md", i));
            fs::write(&file_path, b"dummy content").unwrap();
        }

        // Mede a performance de leitura da árvore recursiva
        let start = Instant::now();
        let tree = load_vault_tree_internal(temp_dir.to_string_lossy().into_owned()).unwrap();
        let duration = start.elapsed();

        println!(
            "\nPERFORMANCE BENCHMARK: Mapeou {} pastas e arquivos em {:?}\n",
            folders_count + files_count,
            duration
        );

        // Garante que todos os diretórios filhos foram indexados
        let root_children = tree.children.unwrap();
        assert_eq!(root_children.len(), folders_count);

        // Limpa a pasta temporária de testes
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_wiki_link_click_transition_real_disk() {
        use sha2::{Sha256, Digest};
        let temp_dir = env::temp_dir().join("mycellia_test_transition");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        // 1. Cria Notas A e B
        let path_a = temp_dir.join("Nota A.md");
        let path_b = temp_dir.join("Nota B.md");
        fs::write(&path_a, "Original A").unwrap();
        fs::write(&path_b, "Original B").unwrap();

        // 2. Calcula hash das notas não-alvo (Nota B)
        let hash_b_before = {
            let bytes = fs::read(&path_b).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };

        // 3. Simula fluxo de transição:
        // A é editada e escrita fisicamente no disco via write_file
        let edit_a_content = "Editado A com [[Nota C]]";
        write_file_internal(&path_a.to_string_lossy(), edit_a_content, false).unwrap();

        // Nota C é criada via create_item
        let path_c_str = create_item(temp_dir.to_string_lossy().into_owned(), "Nota C.md".to_string(), false).unwrap();
        let path_c = Path::new(&path_c_str);

        // Nota C é lida via read_file
        let content_c = read_file(path_c_str.clone()).unwrap();

        // 4. Asserções
        // - Nota A foi escrita corretamente
        let content_a = read_file(path_a.to_string_lossy().into_owned()).unwrap();
        assert_eq!(content_a, edit_a_content);

        // - Nota C foi criada vazia
        assert_eq!(content_c, "");
        assert!(path_c.exists());

        // - Nota B (não-alvo) continua 100% idêntica byte-a-byte
        let hash_b_after = {
            let bytes = fs::read(&path_b).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        assert_eq!(hash_b_before, hash_b_after, "A nota B não-alvo foi corrompida durante a transição!");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_watcher_suppress_atomic_write_events() {
        use std::thread;
        use std::time::Duration;
        
        // 1. Criar diretório temporário no disco
        let temp_dir = std::env::temp_dir().join("mycellia_test_watcher_echo");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        
        let file_path = temp_dir.join("nota.md");
        fs::write(&file_path, "Conteudo Original").unwrap();

        // 2. Inicializar mock Tauri app
        let app = tauri::test::mock_builder()
            .manage(crate::commands::index_db::DbState::default())
            .manage(WatcherState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();
        
        // Inicializa DbState com conexão em memória
        let db_state = handle.state::<crate::commands::index_db::DbState>();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, title TEXT NOT NULL, last_modified INTEGER NOT NULL);", []).unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS links (source_path TEXT NOT NULL, target_name TEXT NOT NULL, target_path TEXT, PRIMARY KEY (source_path, target_name), FOREIGN KEY (source_path) REFERENCES notes (path) ON DELETE CASCADE);", []).unwrap();
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path, title, content, tags, properties);", []).unwrap();
        
        // Insere a nota no DB para que o watcher possa disparar a deleção se achar que ela sumiu
        let canon_file_path = canonicalize_path(&file_path.to_string_lossy());
        conn.execute(
            "INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
            [canon_file_path.clone(), "nota".to_string(), 0.to_string()],
        ).unwrap();
        *db_state.conn.lock().unwrap() = Some(conn);

        // 3. Registrar o listener para "vault-change"
        let changes_received = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let changes_clone = changes_received.clone();
        handle.listen_any("vault-change", move |event| {
            let payload: Vec<VaultChange> = serde_json::from_str(event.payload()).unwrap();
            changes_clone.lock().unwrap().extend(payload);
        });

        // 4. Iniciar o watcher na pasta
        let watcher_state = handle.state::<WatcherState>();
        start_watching(handle.clone(), watcher_state, temp_dir.to_string_lossy().into_owned()).unwrap();

        // Pequena pausa para garantir que o watcher inicializou
        thread::sleep(Duration::from_millis(100));

        // 5. Escrever no arquivo usando write_file
        let new_content = "Conteudo Editado pelo Mycellia";
        write_file(handle.clone(), file_path.to_string_lossy().into_owned(), new_content.to_string(), false).unwrap();

        // Aguardar o debounce (100ms) e o tempo de gravação do disco
        thread::sleep(Duration::from_millis(500));

        // Parar o watcher
        let _ = stop_watching(handle.state::<WatcherState>());

        // 6. Validar que nenhum evento de deleção foi recebido e que todos os eventos do arquivo A foram ecos (comparando por caminhos canônicos)
        let changes = changes_received.lock().unwrap();
        let canon_file_path = canonicalize_path(&file_path.to_string_lossy());
        
        let has_delete = changes.iter().any(|c| c.change_type == "delete" && canonicalize_path(&c.path) == canon_file_path);
        let has_non_echo_modify = changes.iter().any(|c| {
            (c.change_type == "modify" || c.change_type == "create") && canonicalize_path(&c.path) == canon_file_path && !c.is_echo
        });

        assert!(!has_delete, "Erro: detectado evento de deleção falso positivo para escrita própria!");
        assert!(!has_non_echo_modify, "Erro: detectado evento de modificação/criação sem is_echo = true para escrita própria!");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_conflict_handling_writes_correct_snapshot() {
        // 1. Criar diretório temporário no disco e arquivo
        let temp_dir = std::env::temp_dir().join("mycellia_test_conflict_snapshot");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        
        let file_path = temp_dir.join("nota_conflito.md");
        fs::write(&file_path, "Conteudo Original").unwrap();

        // 2. Inicializar mock Tauri app
        let app = tauri::test::mock_builder()
            .manage(crate::commands::index_db::DbState::default())
            .manage(WatcherState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();

        // 3. Simula a deleção física externa da nota no disco
        fs::remove_file(&file_path).unwrap();
        assert!(!file_path.exists());

        // 4. Simula o "Salvar e Recriar" escrevendo o snapshot congelado do usuário
        let user_snapshot = "Conteudo do Snapshot Congelado do Usuario";
        
        // Chamada ao write_file do app para recriar o arquivo
        write_file(handle.clone(), file_path.to_string_lossy().into_owned(), user_snapshot.to_string(), true).unwrap();

        // 5. Afirmação: O arquivo foi recriado com sucesso e contém o snapshot congelado correto
        assert!(file_path.exists(), "O arquivo deveria ter sido recriado pelo write_file!");
        let final_content = fs::read_to_string(&file_path).unwrap();
        assert_eq!(final_content, user_snapshot, "O conteúdo do arquivo recriado difere do snapshot do usuário!");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_write_file_fails_if_not_exists() {
        let temp_dir = env::temp_dir().join("mycellia_test_write_fail");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let file_path = temp_dir.join("non_existent.md");

        // Tenta escrever com allow_create = false -> deve retornar erro
        let res = write_file_internal(
            &file_path.to_string_lossy(),
            "some content",
            false,
        );
        assert!(res.is_err(), "Deveria falhar ao escrever em arquivo que nao existe com allow_create=false");

        // Tenta escrever com allow_create = true -> deve passar e criar o arquivo
        let res_ok = write_file_internal(
            &file_path.to_string_lossy(),
            "some content",
            true,
        );
        assert!(res_ok.is_ok(), "Deveria passar e criar o arquivo com allow_create=true");
        assert!(file_path.exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_open_in_default_app_security() {
        use std::fs;
        
        // 1. Criar diretórios temporários: um representando o Vault e outro fora do Vault
        let temp_dir = std::env::temp_dir().join("mycellia_test_opener_security");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        
        let vault_dir = temp_dir.join("vault");
        fs::create_dir_all(&vault_dir).unwrap();
        
        let outside_dir = temp_dir.join("outside");
        fs::create_dir_all(&outside_dir).unwrap();

        // Criar arquivos para teste ( canonicalize exige que existam )
        let inside_md = vault_dir.join("nota.md");
        fs::write(&inside_md, "content").unwrap();
        
        let inside_png = vault_dir.join("imagem.png");
        fs::write(&inside_png, "content").unwrap();
        
        let outside_png = outside_dir.join("imagem_externa.png");
        fs::write(&outside_png, "content").unwrap();

        // 2. Inicializar mock Tauri app
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_opener::init())
            .manage(crate::commands::index_db::DbState::default())
            .manage(WatcherState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();

        // 3. Salvar configuração com o vault temporário ativo
        let config = crate::commands::config::AppConfig {
            current_vault: Some(vault_dir.to_string_lossy().to_string()),
            recent_vaults: vec![vault_dir.to_string_lossy().to_string()],
            theme: "dark".to_string(),
            sidebar_width: 260,
        };
        crate::commands::config::save_config(handle.clone(), config).unwrap();

        // 4. Cenário A: Tentar abrir arquivo fora do Vault -> deve retornar erro de acesso negado
        let res_outside = open_in_default_app(handle.clone(), outside_png.to_string_lossy().to_string());
        assert!(res_outside.is_err(), "Deveria falhar ao tentar abrir arquivo fora do Vault");
        let err_msg = res_outside.unwrap_err();
        assert!(err_msg.contains("Acesso negado") || err_msg.contains("fora do vault"), "Mensagem de erro incorreta para arquivo fora do vault: {}", err_msg);

        // 5. Cenário B: Tentar abrir arquivo Markdown (.md) dentro do Vault -> deve retornar erro de bloqueio de Markdown
        let res_md = open_in_default_app(handle.clone(), inside_md.to_string_lossy().to_string());
        assert!(res_md.is_err(), "Deveria falhar ao tentar abrir arquivo Markdown no app padrão");
        let err_msg_md = res_md.unwrap_err();
        assert!(err_msg_md.contains("Markdown"), "Mensagem de erro incorreta para arquivo Markdown: {}", err_msg_md);

        // 6. Cenário C: Abrir arquivo não-.md válido dentro do Vault -> deve passar pela verificação
        // Como o opener nativo chama o SO para abrir um arquivo PNG que criamos e existe,
        // pode retornar Ok(()) ou erro caso o ambiente de testes não tenha visualizador registrado.
        // O importante é verificar que passou pela barreira de segurança de contenção e de Markdown.
        // Vamos apenas verificar que o erro retornado NÃO é "Acesso negado" e nem de "Markdown".
        let res_png = open_in_default_app(handle.clone(), inside_png.to_string_lossy().to_string());
        if let Err(e) = res_png {
            assert!(!e.contains("Acesso negado") && !e.contains("fora do vault") && !e.contains("Markdown"), 
                "Falhou na barreira de segurança para arquivo PNG dentro do vault: {}", e);
        }

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_save_pasted_image_disk_real() {
        use sha2::{Sha256, Digest};

        let temp_dir = std::env::temp_dir().join("mycellia_test_paste_image");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let vault_dir = temp_dir.join("vault");
        fs::create_dir_all(&vault_dir).unwrap();

        // 1. Inicializa mock Tauri app
        let app = tauri::test::mock_builder()
            .manage(crate::commands::index_db::DbState::default())
            .manage(WatcherState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();

        // 2. Salva configuração com o vault temporário ativo
        let config = crate::commands::config::AppConfig {
            current_vault: Some(vault_dir.to_string_lossy().to_string()),
            recent_vaults: vec![vault_dir.to_string_lossy().to_string()],
            theme: "dark".to_string(),
            sidebar_width: 260,
        };
        crate::commands::config::save_config(handle.clone(), config).unwrap();

        // Cria uma nota de controle (arquivo não-alvo) para verificar que ele não é alterado
        let control_file = vault_dir.join("controle.md");
        fs::write(&control_file, "conteudo de controle").unwrap();
        let hash_control_before = {
            let bytes = fs::read(&control_file).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };

        // 3. Salva uma imagem em base64 (conteúdo: "Hello World!")
        let hello_b64 = "SGVsbG8gV29ybGQh"; // base64 para "Hello World!"
        let ext = "png".to_string();

        let filename_1 = save_pasted_image(handle.clone(), hello_b64.to_string(), ext.clone()).unwrap();
        
        // Verifica que o arquivo foi criado com os bytes corretos
        let attachments_dir = vault_dir.join("attachments");
        let path_1 = attachments_dir.join(&filename_1);
        assert!(path_1.exists(), "A imagem salva deve existir");
        let content_1 = fs::read_to_string(&path_1).unwrap();
        assert_eq!(content_1, "Hello World!");

        // 4. Salva a mesma imagem no mesmo segundo (simula colisão)
        let filename_2 = save_pasted_image(handle.clone(), hello_b64.to_string(), ext.clone()).unwrap();
        let path_2 = attachments_dir.join(&filename_2);
        assert!(path_2.exists(), "A segunda imagem salva deve existir");
        assert_ne!(filename_1, filename_2, "O nome do arquivo colidido deve ter um sufixo numérico");
        assert!(filename_2.contains("_1"), "O nome deve conter o sufixo _1");

        // 5. Verifica que o arquivo de controle (não-alvo) não foi alterado de forma alguma (SHA256 intacto)
        let hash_control_after = {
            let bytes = fs::read(&control_file).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        assert_eq!(hash_control_before, hash_control_after, "O arquivo não-alvo não deve ser alterado");

        // 6. Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_move_item_internal_validations() {
        use sha2::{Sha256, Digest};

        let temp_dir = env::temp_dir().join("mycellia_test_move_internal");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let source_folder = temp_dir.join("origem");
        let dest_folder = temp_dir.join("destino");
        fs::create_dir_all(&source_folder).unwrap();
        fs::create_dir_all(&dest_folder).unwrap();

        let file_to_move = source_folder.join("nota.md");
        fs::write(&file_to_move, "conteudo original").unwrap();

        // Nota de controle (não-alvo)
        let control_file = temp_dir.join("controle.md");
        fs::write(&control_file, "controle intacto").unwrap();
        let hash_before = {
            let bytes = fs::read(&control_file).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };

        // 1. Sucesso: Mover nota.md da pasta "origem" para "destino"
        let res = move_item_internal(
            file_to_move.to_string_lossy().into_owned(),
            dest_folder.to_string_lossy().into_owned(),
        );
        assert!(res.is_ok(), "Falhou ao mover nota.md para destino");
        let new_path_str = res.unwrap();
        let new_path = Path::new(&new_path_str);
        assert!(new_path.exists());
        assert!(!file_to_move.exists());
        assert_eq!(fs::read_to_string(new_path).unwrap(), "conteudo original");

        // 2. Colisão: Mover novamente para onde já existe (deve abortar com erro claro)
        let file_another = source_folder.join("nota.md");
        fs::write(&file_another, "outro conteudo").unwrap();
        let res_col = move_item_internal(
            file_another.to_string_lossy().into_owned(),
            dest_folder.to_string_lossy().into_owned(),
        );
        assert!(res_col.is_err(), "Deveria falhar por colisão de mesmo nome");
        assert!(res_col.unwrap_err().contains("Já existe um arquivo ou pasta"));

        // 3. Anti-loop: Mover pasta destino para dentro de si mesma
        let nested_folder = dest_folder.join("subpasta");
        fs::create_dir_all(&nested_folder).unwrap();
        let res_loop = move_item_internal(
            dest_folder.to_string_lossy().into_owned(),
            nested_folder.to_string_lossy().into_owned(),
        );
        assert!(res_loop.is_err(), "Deveria falhar ao tentar mover pasta para dentro de si mesma");
        assert!(res_loop.unwrap_err().contains("Não é possível mover uma pasta para dentro de si mesma"));

        // 4. Integridade do arquivo não-alvo (controle)
        let hash_after = {
            let bytes = fs::read(&control_file).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        assert_eq!(hash_before, hash_after, "O arquivo não-alvo foi corrompido ou modificado!");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_watcher_suppress_move_events() {
        use std::thread;
        use std::time::Duration;

        let temp_dir = env::temp_dir().join("mycellia_test_watcher_move");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let vault_dir = temp_dir.join("vault");
        let sub_folder = vault_dir.join("sub");
        fs::create_dir_all(&sub_folder).unwrap();

        let file_path = vault_dir.join("nota.md");
        fs::write(&file_path, "conteudo").unwrap();

        // Inicializa mock Tauri app
        let app = tauri::test::mock_builder()
            .manage(crate::commands::index_db::DbState::default())
            .manage(WatcherState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();

        // Configuração ativa
        let config = crate::commands::config::AppConfig {
            current_vault: Some(vault_dir.to_string_lossy().to_string()),
            recent_vaults: vec![vault_dir.to_string_lossy().to_string()],
            theme: "dark".to_string(),
            sidebar_width: 260,
        };
        crate::commands::config::save_config(handle.clone(), config).unwrap();

        // Inicializa DB em memória
        let db_state = handle.state::<crate::commands::index_db::DbState>();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, title TEXT NOT NULL, last_modified INTEGER NOT NULL);", []).unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS links (source_path TEXT NOT NULL, target_name TEXT NOT NULL, target_path TEXT, PRIMARY KEY (source_path, target_name), FOREIGN KEY (source_path) REFERENCES notes (path) ON DELETE CASCADE);", []).unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS tags (note_path TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (note_path, tag), FOREIGN KEY (note_path) REFERENCES notes (path) ON DELETE CASCADE);", []).unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS properties (note_path TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (note_path, key), FOREIGN KEY (note_path) REFERENCES notes (path) ON DELETE CASCADE);", []).unwrap();
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path, title, content, tags, properties);", []).unwrap();
        
        let canon_file_path = canonicalize_path(&file_path.to_string_lossy());
        conn.execute(
            "INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
            [canon_file_path, "nota".to_string(), 0.to_string()],
        ).unwrap();
        *db_state.conn.lock().unwrap() = Some(conn);

        // Ouvir eventos vault-change
        let changes_received = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let changes_clone = changes_received.clone();
        handle.listen_any("vault-change", move |event| {
            let payload: Vec<VaultChange> = serde_json::from_str(event.payload()).unwrap();
            changes_clone.lock().unwrap().extend(payload);
        });

        // Iniciar watcher
        let watcher_state = handle.state::<WatcherState>();
        start_watching(handle.clone(), watcher_state, vault_dir.to_string_lossy().into_owned()).unwrap();

        thread::sleep(Duration::from_millis(100));

        // Mover via Tauri command move_item
        let dest_path = sub_folder.join("nota.md");
        let res = move_item(
            handle.clone(),
            file_path.to_string_lossy().into_owned(),
            sub_folder.to_string_lossy().into_owned(),
        );
        assert!(res.is_ok(), "Falhou ao executar comando move_item: {:?}", res);

        // Espera debounce
        thread::sleep(Duration::from_millis(500));

        // Parar o watcher
        let _ = stop_watching(handle.state::<WatcherState>());

        // 1. Atestar que no banco de dados o caminho antigo foi removido e o novo inserido (usando caminhos canônicos)
        let conn_guard = db_state.conn.lock().unwrap();
        let conn_ref = conn_guard.as_ref().unwrap();
        
        let exists_old: bool = conn_ref.query_row(
            "SELECT 1 FROM notes WHERE path = ?",
            [canonicalize_path(&file_path.to_string_lossy())],
            |_| Ok(true)
        ).unwrap_or(false);
        assert!(!exists_old, "O caminho antigo da nota deveria ter sido removido do índice.");

        let exists_new: bool = conn_ref.query_row(
            "SELECT 1 FROM notes WHERE path = ?",
            [canonicalize_path(&dest_path.to_string_lossy())],
            |_| Ok(true)
        ).unwrap_or(false);
        assert!(exists_new, "O novo caminho da nota deveria estar inserido no índice.");

        // 2. Atestar que os eventos de alteração foram silenciados (supressão de eco completa)
        let changes = changes_received.lock().unwrap();
        let has_non_echo_delete = changes.iter().any(|c| c.change_type == "delete" && !c.is_echo);
        let has_non_echo_create = changes.iter().any(|c| c.change_type == "create" && !c.is_echo);
        
        assert!(!has_non_echo_delete, "Erro: detectado evento de deleção não suprimido.");
        assert!(!has_non_echo_create, "Erro: detectado evento de criação não suprimido.");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_watcher_linux_inotify_atomic_and_external_writes() {
        use std::thread;
        use std::time::Duration;
        
        // 1. Criar diretório temporário no disco
        let temp_dir = std::env::temp_dir().join("mycellia_test_watcher_linux");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        
        let file_path = temp_dir.join("nota_linux.md");
        fs::write(&file_path, "Conteudo Inicial").unwrap();

        // 2. Inicializar mock Tauri app
        let app = tauri::test::mock_builder()
            .manage(crate::commands::index_db::DbState::default())
            .manage(WatcherState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();
        
        // Inicializa DbState com conexão em memória
        let db_state = handle.state::<crate::commands::index_db::DbState>();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, title TEXT NOT NULL, last_modified INTEGER NOT NULL);", []).unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS links (source_path TEXT NOT NULL, target_name TEXT NOT NULL, target_path TEXT, PRIMARY KEY (source_path, target_name), FOREIGN KEY (source_path) REFERENCES notes (path) ON DELETE CASCADE);", []).unwrap();
        conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(path, title, content, tags, properties);", []).unwrap();
        
        // Insere a nota no DB
        conn.execute(
            "INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
            [file_path.to_string_lossy().to_string(), "nota_linux".to_string(), 0.to_string()],
        ).unwrap();
        *db_state.conn.lock().unwrap() = Some(conn);

        // 3. Registrar o listener para "vault-change"
        let changes_received = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let changes_clone = changes_received.clone();
        handle.listen_any("vault-change", move |event| {
            let payload: Vec<VaultChange> = serde_json::from_str(event.payload()).unwrap();
            changes_clone.lock().unwrap().extend(payload);
        });

        // 4. Iniciar o watcher na pasta
        let watcher_state = handle.state::<WatcherState>();
        start_watching(handle.clone(), watcher_state, temp_dir.to_string_lossy().into_owned()).unwrap();

        thread::sleep(Duration::from_millis(100));

        // 5. Simular escrita externa (que causa exclusão temporária seguida de recriação/modificação no Linux/inotify)
        let new_content = "Conteudo Alterado Externamente";
        let temp_file_path = file_path.with_extension("tmp");
        fs::write(&temp_file_path, new_content).unwrap();
        fs::rename(&temp_file_path, &file_path).unwrap();

        // Aguardar o debounce do watcher e atualização do banco
        thread::sleep(Duration::from_millis(600));

        // Parar o watcher
        let _ = stop_watching(handle.state::<WatcherState>());

        // 6. Asserções
        // Asserção 1: O arquivo físico continua existindo
        assert!(file_path.exists(), "Erro: O arquivo físico nota_linux.md deveria existir no disco!");

        // Asserção 2: O banco de dados (SQLite) continua com a nota indexada (não foi excluída permanentemente pelo falso-delete)
        let conn_lock = db_state.conn.lock().unwrap();
        let db = conn_lock.as_ref().unwrap();
        let note_exists_in_db: bool = db.query_row(
            "SELECT exists(SELECT 1 FROM notes WHERE path = ?)",
            [file_path.to_string_lossy().to_string()],
            |row| row.get(0)
        ).unwrap();
        assert!(note_exists_in_db, "Erro: nota foi excluída permanentemente do índice SQLite devido a um falso-delete!");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
