// Tripwire (F0+F1): barra unwrap/expect NOVO neste módulo de I/O (clippy::unwrap_used/expect_used).
// Todos os sites de produção foram convertidos para Result (F1); nenhum #[allow] restante.
#![deny(clippy::unwrap_used, clippy::expect_used)]

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Emitter};
use serde::{Serialize, Deserialize};

pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
    pub is_rebuilding: AtomicBool,
    pub is_indexing: AtomicBool,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
            is_rebuilding: AtomicBool::new(false),
            is_indexing: AtomicBool::new(false),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResult {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NoteInfo {
    pub path: String,
    pub basename: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Backlink {
    pub source_path: String,
    pub source_title: String,
    pub context: String,
}

// Auxiliar para pegar o caminho do index.db no AppData
fn get_db_path(app: &AppHandle) -> Option<PathBuf> {
    let mut path = app.path().app_config_dir().ok()?;
    let _ = std::fs::create_dir_all(&path);
    path.push("index.db");
    Some(path)
}

// Inicializa a conexão SQLite e cria o Schema
fn init_db_connection(db_path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(db_path)?;
    
    // Habilita modo WAL para concorrência e velocidade
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    
    // Habilita Foreign Keys para deleções em cascata
    conn.execute("PRAGMA foreign_keys = ON;", [])?;
    
    // Criação de Tabelas
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            path TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            last_modified INTEGER NOT NULL
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS links (
            source_path TEXT NOT NULL,
            target_name TEXT NOT NULL,
            target_path TEXT,
            PRIMARY KEY (source_path, target_name),
            FOREIGN KEY (source_path) REFERENCES notes (path) ON DELETE CASCADE
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tags (
            note_path TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (note_path, tag),
            FOREIGN KEY (note_path) REFERENCES notes (path) ON DELETE CASCADE
        );",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS properties (
            note_path TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (note_path, key),
            FOREIGN KEY (note_path) REFERENCES notes (path) ON DELETE CASCADE
        );",
        [],
    )?;

    // Criação da tabela virtual FTS5 para busca full-text
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            path UNINDEXED,
            title,
            content,
            tags,
            properties
        );",
        [],
    )?;

    // Trigger de deleção automática no FTS5
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
            DELETE FROM notes_fts WHERE path = OLD.path;
        END;",
        [],
    )?;

    Ok(conn)
}

// Varre recursivamente a pasta coletando caminhos de arquivos markdown
fn get_all_md_files(dir: &Path, files: &mut Vec<PathBuf>) {
    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') {
                    continue;
                }
                if path.is_dir() {
                    get_all_md_files(&path, files);
                } else if path.is_file() && name.ends_with(".md") {
                    files.push(path);
                }
            }
        }
    }
}

// Auxiliar determinístico para resolver o caminho de destino de um wiki-link
pub fn resolve_target_path(target_name: &str, all_paths: &[String], vault_path: &str) -> Option<String> {
    // 1. Busca prioritária por correspondência exata (case-sensitive)
    let mut exact_candidates = Vec::new();
    for path in all_paths {
        let p_path = Path::new(path);
        let file_name = p_path.file_name().unwrap_or_default().to_string_lossy();
        let basename = file_name.strip_suffix(".md").unwrap_or(&file_name);
        
        if basename == target_name {
            exact_candidates.push(path.clone());
            continue;
        }
        
        if let Ok(rel) = p_path.strip_prefix(vault_path) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let rel_basename = rel_str.strip_suffix(".md").unwrap_or(&rel_str);
            if rel_basename == target_name {
                exact_candidates.push(path.clone());
            }
        }
    }

    if !exact_candidates.is_empty() {
        // Desempate determinístico para matches exatos
        exact_candidates.sort_by(|a, b| {
            let rel_a = Path::new(a).strip_prefix(vault_path).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            let rel_b = Path::new(b).strip_prefix(vault_path).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            
            let len_a = rel_a.len();
            let len_b = rel_b.len();
            
            if len_a != len_b {
                len_a.cmp(&len_b)
            } else {
                rel_a.cmp(&rel_b)
            }
        });
        return exact_candidates.first().cloned();
    }

    // 2. Fallback case-insensitive se não houver match exato
    let target_lower = target_name.to_lowercase();
    let mut candidates = Vec::new();

    for path in all_paths {
        let p_path = Path::new(path);
        let file_name = p_path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
        let basename = file_name.strip_suffix(".md").unwrap_or(&file_name);
        
        if basename == target_lower {
            candidates.push(path.clone());
            continue;
        }
        
        if let Ok(rel) = p_path.strip_prefix(vault_path) {
            let rel_str = rel.to_string_lossy().replace('\\', "/").to_lowercase();
            let rel_basename = rel_str.strip_suffix(".md").unwrap_or(&rel_str);
            if rel_basename == target_lower {
                candidates.push(path.clone());
            }
        }
    }

    if candidates.is_empty() {
        return None;
    }

    if candidates.len() > 1 {
        eprintln!(
            "Warning: Wiki-link collision warning for '{}'. Multiple matches exist case-insensitively: {:?}",
            target_name, candidates
        );
    }

    // Desempate determinístico secundário
    candidates.sort_by(|a, b| {
        let rel_a = Path::new(a).strip_prefix(vault_path).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let rel_b = Path::new(b).strip_prefix(vault_path).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        
        let len_a = rel_a.len();
        let len_b = rel_b.len();
        
        if len_a != len_b {
            len_a.cmp(&len_b)
        } else {
            rel_a.cmp(&rel_b)
        }
    });

    candidates.first().cloned()
}

// Indexa o vault de forma incremental
fn index_vault(app: &AppHandle, vault_path: &str) -> Result<(), String> {
    let state = app.state::<DbState>();
    let mut conn_lock = state.conn.lock().map_err(|e| format!("Erro no lock de conexão: {}", e))?;
    
    if conn_lock.is_none() {
        let db_path = get_db_path(app).ok_or("Falha ao obter caminho do banco")?;
        let conn = init_db_connection(&db_path).map_err(|e| format!("Falha ao inicializar o banco: {}", e))?;
        *conn_lock = Some(conn);
    }
    let conn = conn_lock.as_mut().ok_or_else(|| "Conexão com o banco perdida".to_string())?;

    // 1. Mapeia dados atuais do SQLite: path -> last_modified
    let db_notes_map: std::collections::HashMap<String, i64> = {
        let mut stmt = conn.prepare("SELECT path, last_modified FROM notes").map_err(|e| e.to_string())?;
        let db_notes: Vec<(String, i64)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }).map_err(|e| e.to_string())?.flatten().collect();
        db_notes.into_iter().collect()
    };

    // 2. Escaneia todos os .md no vault
    let vault_path_buf = PathBuf::from(vault_path);
    let mut fs_files = Vec::new();
    get_all_md_files(&vault_path_buf, &mut fs_files);

    // 3. Determina o delta (novos/modificados e deletados)
    let mut to_update = Vec::new();
    let mut current_paths = std::collections::HashSet::new();

    for file_path in fs_files {
        let path_str = file_path.to_string_lossy().into_owned();
        current_paths.insert(path_str.clone());

        let mtime = if let Ok(metadata) = std::fs::metadata(&file_path) {
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

        if let Some(&db_mtime) = db_notes_map.get(&path_str) {
            if mtime > db_mtime {
                to_update.push((file_path, mtime));
            }
        } else {
            to_update.push((file_path, mtime));
        }
    }

    let to_delete: Vec<String> = db_notes_map
        .keys()
        .filter(|p| !current_paths.contains(*p))
        .cloned()
        .collect();

    // 4. Executa transação em lote (Fast Batch)
    let tx = conn.transaction().map_err(|e| format!("Falha ao abrir transação: {}", e))?;
    let all_paths_vec: Vec<String> = current_paths.iter().cloned().collect();

    // Deleta registros obsoletos (o CASCADE limpa links/tags/properties e o TRIGGER limpa fts)
    for path in to_delete {
        tx.execute("DELETE FROM notes WHERE path = ?", [&path]).map_err(|e| e.to_string())?;
    }

    // Insere ou atualiza notas modificadas/novas
    let total_to_update = to_update.len();
    let mut current_index = 0;

    for (file_path, mtime) in to_update {
        current_index += 1;
        if total_to_update > 0 && (current_index % 10 == 0 || current_index == total_to_update) {
            let _ = app.emit("indexing-status", format!("progress:{}/{}", current_index, total_to_update));
        }
        let path_str = file_path.to_string_lossy().into_owned();
        let file_name = file_path.file_name().unwrap_or_default().to_string_lossy().into_owned();

        // Leitura estritamente read-only em UTF-8
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Aviso: Falha ao ler nota read-only {}: {}", path_str, e);
                continue;
            }
        };

        // Parser estruturado do parser.rs
        let meta = super::parser::parse_markdown(&content, &file_name);

        tx.execute(
            "INSERT OR REPLACE INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
            rusqlite::params![path_str, meta.title, mtime],
        ).map_err(|e| e.to_string())?;

        // Limpa relacionamentos antigos antes de atualizar
        tx.execute("DELETE FROM links WHERE source_path = ?", [&path_str]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM tags WHERE note_path = ?", [&path_str]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM properties WHERE note_path = ?", [&path_str]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM notes_fts WHERE path = ?", [&path_str]).map_err(|e| e.to_string())?;

        // Insere novos links
        for link in meta.links {
            let resolved_path = resolve_target_path(&link, &all_paths_vec, vault_path);

            tx.execute(
                "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, ?)",
                rusqlite::params![path_str, link, resolved_path],
            ).map_err(|e| e.to_string())?;
        }

        // Insere novas tags
        for tag in meta.tags.clone() {
            tx.execute(
                "INSERT OR REPLACE INTO tags (note_path, tag) VALUES (?, ?)",
                rusqlite::params![path_str, tag],
            ).map_err(|e| e.to_string())?;
        }

        // Insere propriedades
        for (key, val) in meta.properties {
            tx.execute(
                "INSERT OR REPLACE INTO properties (note_path, key, value) VALUES (?, ?, ?)",
                rusqlite::params![path_str, key, val],
            ).map_err(|e| e.to_string())?;
        }

        // Insere no FTS5
        let tags_joined = meta.tags.join(" ");
        tx.execute(
            "INSERT INTO notes_fts (path, title, content, tags, properties) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![path_str, meta.title, meta.clean_text, tags_joined, ""],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| format!("Erro no commit da transação: {}", e))?;

    Ok(())
}

// Inicia a indexação assíncrona em background
pub fn start_indexing(app: AppHandle, vault_path: String) {
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let state = app_clone.state::<DbState>();
        state.is_indexing.store(true, Ordering::Relaxed);
        let _ = app_clone.emit("indexing-status", "started");

        let res = index_vault(&app_clone, &vault_path);

        state.is_indexing.store(false, Ordering::Relaxed);
        match res {
            Ok(_) => {
                let _ = app_clone.emit("indexing-status", "finished");
            }
            Err(e) => {
                eprintln!("Erro na indexação: {}", e);
                let _ = app_clone.emit("indexing-status", &format!("error: {}", e));
            }
        }
    });
}

// Comando Tauri: Reconstrói o índice do zero
#[tauri::command]
pub fn rebuild_index(app: AppHandle, vault_path: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    
    // 1. Sinaliza reconstrução
    state.is_rebuilding.store(true, Ordering::Relaxed);
    
    // 2. Fecha conexão ativamente
    {
        let mut conn_lock = state.conn.lock().map_err(|e| format!("Erro no lock do banco: {}", e))?;
        *conn_lock = None;
    }
    
    // 3. Deleta o banco do disco
    if let Some(db_path) = get_db_path(&app) {
        if db_path.exists() {
            let _ = std::fs::remove_file(&db_path);
        }
    }
    
    state.is_rebuilding.store(false, Ordering::Relaxed);
    
    // 4. Reinicia a indexação
    start_indexing(app, vault_path);
    
    Ok(())
}

// Comando Tauri: Busca Full-Text no FTS5
#[tauri::command]
pub fn search_notes<R: tauri::Runtime>(app: tauri::AppHandle<R>, query: String) -> Result<Vec<SearchResult>, String> {
    let state = app.state::<DbState>();
    
    // Se o banco estiver travado em rebuild ou em indexação, retorna vazio seguro
    if state.is_rebuilding.load(Ordering::Relaxed) || state.is_indexing.load(Ordering::Relaxed) {
        return Ok(Vec::new());
    }
    
    let mut conn_lock = state.conn.lock().map_err(|e| format!("Erro no lock de conexão: {}", e))?;
    if conn_lock.is_none() {
        return Ok(Vec::new());
    }
    let conn = conn_lock.as_mut().ok_or_else(|| "Conexão com o banco perdida".to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT path, title, snippet(notes_fts, -1, '<b>', '</b>', '...', 16) 
         FROM notes_fts 
         WHERE notes_fts MATCH ? 
         ORDER BY bm25(notes_fts) LIMIT 50"
    ).map_err(|e| format!("Erro na preparação do SQL FTS5: {}", e))?;
    
    let rows = stmt.query_map([query], |row| {
        Ok(SearchResult {
            path: row.get(0)?,
            title: row.get(1)?,
            snippet: row.get(2)?,
        })
    }).map_err(|e| format!("Erro de execução FTS5: {}", e))?;
    
    let mut results = Vec::new();
    for row in rows.flatten() {
        results.push(row);
    }
    
    Ok(results)
}

// Comando Tauri: Retorna todos os caminhos que combinam com a busca FTS5 (sem limite e sem snippets)
#[tauri::command]
pub fn get_matching_paths<R: tauri::Runtime>(app: tauri::AppHandle<R>, query: String) -> Result<Vec<String>, String> {
    let state = app.state::<DbState>();
    
    if state.is_rebuilding.load(Ordering::Relaxed) || state.is_indexing.load(Ordering::Relaxed) {
        return Ok(Vec::new());
    }
    
    let mut conn_lock = state.conn.lock().map_err(|e| format!("Erro no lock de conexão: {}", e))?;
    if conn_lock.is_none() {
        return Ok(Vec::new());
    }
    let conn = conn_lock.as_mut().ok_or_else(|| "Conexão com o banco perdida".to_string())?;
    
    let mut stmt = conn.prepare(
        "SELECT path FROM notes_fts WHERE notes_fts MATCH ?"
    ).map_err(|e| format!("Erro na preparação do SQL FTS5 matching paths: {}", e))?;
    
    let rows = stmt.query_map([query], |row| {
        let path: String = row.get(0)?;
        Ok(path)
    }).map_err(|e| format!("Erro de execução FTS5: {}", e))?;
    
    let mut results = Vec::new();
    for row in rows.flatten() {
        results.push(row);
    }
    
    Ok(results)
}

// Comando Tauri: Retorna status se o índice está rodando
#[tauri::command]
pub fn get_indexing_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<DbState>();
    Ok(state.is_indexing.load(Ordering::Relaxed))
}

// Comando Tauri: Dispara a indexação incremental em background
#[tauri::command]
pub fn start_indexing_command(app: AppHandle, vault_path: String) -> Result<(), String> {
    start_indexing(app, vault_path);
    Ok(())
}

// Comando Tauri: Retorna a lista de todas as notas indexadas com seus basenames (title no DB)
#[tauri::command]
pub fn get_all_notes(app: AppHandle) -> Result<Vec<NoteInfo>, String> {
    let state = app.state::<DbState>();
    if state.is_rebuilding.load(Ordering::Relaxed) || state.is_indexing.load(Ordering::Relaxed) {
        return Ok(Vec::new());
    }
    let mut conn_lock = state.conn.lock().map_err(|e| format!("Erro no lock de conexão: {}", e))?;
    if conn_lock.is_none() {
        return Ok(Vec::new());
    }
    let conn = conn_lock.as_mut().ok_or_else(|| "Conexão com o banco perdida".to_string())?;
    let mut stmt = conn.prepare("SELECT path, title FROM notes").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(NoteInfo {
            path: row.get(0)?,
            basename: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut notes = Vec::new();
    for row in rows.flatten() {
        notes.push(row);
    }
    Ok(notes)
}

// Comando Tauri: Busca backlinks para a nota ativa de forma precisa (usando target_path)
#[tauri::command]
pub fn get_backlinks(app: AppHandle, target_path: String) -> Result<Vec<Backlink>, String> {
    let state = app.state::<DbState>();
    if state.is_rebuilding.load(Ordering::Relaxed) || state.is_indexing.load(Ordering::Relaxed) {
        return Ok(Vec::new());
    }
    
    let mut conn_lock = state.conn.lock().map_err(|e| format!("Erro no lock de conexão: {}", e))?;
    if conn_lock.is_none() {
        return Ok(Vec::new());
    }
    let conn = conn_lock.as_mut().ok_or_else(|| "Conexão com o banco perdida".to_string())?;

    // 1. Encontra o título da nota de destino
    let target_title: String = match conn.query_row(
        "SELECT title FROM notes WHERE path = ?",
        [&target_path],
        |row| row.get(0)
    ) {
        Ok(t) => t,
        Err(_) => {
            Path::new(&target_path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        }
    };

    // 2. Query dos source_paths que linkam para este target (apenas pelo target_path, sem OR target_name para evitar colisões)
    let mut stmt = conn.prepare(
        "SELECT l.source_path, n.title 
         FROM links l
         JOIN notes n ON l.source_path = n.path
         WHERE l.target_path = ?"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(rusqlite::params![target_path], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;

    let mut backlinks = Vec::new();

    // 3. Para cada link, lê o arquivo de origem (estritamente read-only) e extrai o contexto
    for row in rows.flatten() {
        let (source_path, source_title) = row;
        
        let content = match std::fs::read_to_string(&source_path) {
            Ok(c) => c,
            Err(_) => continue, // ignora se o arquivo sumiu do disco
        };

        // Procura a linha que contém o link [[target_title]] ou [[target_name]]
        let mut context_line = String::new();
        let target_title_lower = target_title.to_lowercase();
        
        for line in content.lines() {
            let line_lower = line.to_lowercase();
            if line_lower.contains(&format!("[[{}", target_title_lower)) {
                context_line = line.trim().to_string();
                break;
            }
        }

        if context_line.is_empty() {
            context_line = format!("Link para [[{}]]", target_title);
        }

        backlinks.push(Backlink {
            source_path,
            source_title,
            context: context_line,
        });
    }

    Ok(backlinks)
}

pub fn re_resolve_all_links(tx: &rusqlite::Transaction, vault_path: &str) -> Result<(), rusqlite::Error> {
    let start = std::time::Instant::now();
    
    let mut stmt = tx.prepare("SELECT path FROM notes")?;
    let all_paths_vec: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    
    let mut basename_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut rel_path_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    
    for path in &all_paths_vec {
        let p_path = Path::new(path);
        if let Some(file_name) = p_path.file_name() {
            let file_name_str = file_name.to_string_lossy().to_lowercase();
            let basename = file_name_str.strip_suffix(".md").unwrap_or(&file_name_str).to_string();
            basename_map.entry(basename).or_default().push(path.clone());
        }
        
        if let Ok(rel) = p_path.strip_prefix(vault_path) {
            let rel_str = rel.to_string_lossy().replace('\\', "/").to_lowercase();
            let rel_basename = rel_str.strip_suffix(".md").unwrap_or(&rel_str).to_string();
            rel_path_map.insert(rel_basename, path.clone());
        }
    }
    
    let mut stmt = tx.prepare("SELECT source_path, target_name, target_path FROM links")?;
    let links: Vec<(String, String, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    
    let mut update_stmt = tx.prepare("UPDATE links SET target_path = ? WHERE source_path = ? AND target_name = ?")?;
    let mut update_count = 0;
    
    for (source_path, target_name, current_target_path) in links {
        let target_lower = target_name.to_lowercase();
        let mut candidates = Vec::new();
        
        if let Some(paths) = basename_map.get(&target_lower) {
            for p in paths {
                candidates.push(p.clone());
            }
        }
        
        if let Some(p) = rel_path_map.get(&target_lower) {
            if !candidates.contains(p) {
                candidates.push(p.clone());
            }
        }
        
        let resolved = if candidates.is_empty() {
            None
        } else {
            candidates.sort_by(|a, b| {
                let rel_a = Path::new(a).strip_prefix(vault_path).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                let rel_b = Path::new(b).strip_prefix(vault_path).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                
                let len_a = rel_a.len();
                let len_b = rel_b.len();
                
                if len_a != len_b {
                    len_a.cmp(&len_b)
                } else {
                    rel_a.cmp(&rel_b)
                }
            });
            candidates.first().cloned()
        };
        
        if resolved != current_target_path {
            update_stmt.execute(rusqlite::params![resolved, source_path, target_name])?;
            update_count += 1;
        }
    }
    
    println!(
        "re_resolve_all_links performance check: processed links, updated {} target_paths in {:?}",
        update_count, start.elapsed()
    );
    
    Ok(())
}

pub fn index_single_file_in_tx(
    tx: &rusqlite::Transaction,
    file_path: &Path,
    mtime: i64,
) -> Result<(), String> {
    let path_str = file_path.to_string_lossy().into_owned();
    let file_name = file_path.file_name().unwrap_or_default().to_string_lossy().into_owned();

    let content = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Falha ao ler arquivo: {}", e))?;

    let meta = super::parser::parse_markdown(&content, &file_name);

    tx.execute(
        "INSERT OR REPLACE INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
        rusqlite::params![path_str, meta.title, mtime],
    ).map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM links WHERE source_path = ?", [&path_str]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM tags WHERE note_path = ?", [&path_str]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM properties WHERE note_path = ?", [&path_str]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM notes_fts WHERE path = ?", [&path_str]).map_err(|e| e.to_string())?;

    for link in meta.links {
        tx.execute(
            "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
            rusqlite::params![path_str, link],
        ).map_err(|e| e.to_string())?;
    }

    for tag in &meta.tags {
        tx.execute(
            "INSERT OR REPLACE INTO tags (note_path, tag) VALUES (?, ?)",
            rusqlite::params![path_str, tag],
        ).map_err(|e| e.to_string())?;
    }

    for (key, val) in meta.properties {
        tx.execute(
            "INSERT OR REPLACE INTO properties (note_path, key, value) VALUES (?, ?, ?)",
            rusqlite::params![path_str, key, val],
        ).map_err(|e| e.to_string())?;
    }

    let tags_joined = meta.tags.join(" ");
    tx.execute(
        "INSERT INTO notes_fts (path, title, content, tags, properties) VALUES (?, ?, ?, ?, ?)",
        rusqlite::params![path_str, meta.title, meta.clean_text, tags_joined, ""],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn delete_file_in_tx(tx: &rusqlite::Transaction, path_str: &str) -> Result<(), String> {
    tx.execute("DELETE FROM notes WHERE path = ?", [path_str]).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub exists: bool,
    pub degree: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GraphLink {
    pub source: String,
    pub target: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

#[tauri::command]
pub fn get_graph_data<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<GraphData, String> {
    let state = app.state::<DbState>();
    if state.is_rebuilding.load(Ordering::Relaxed) || state.is_indexing.load(Ordering::Relaxed) {
        return Err("Database is currently indexing or rebuilding".to_string());
    }
    
    let mut conn_lock = state.conn.lock().map_err(|e| format!("Erro no lock de conexão: {}", e))?;
    if conn_lock.is_none() {
        return Err("Database connection not initialized".to_string());
    }
    let conn = conn_lock.as_mut().ok_or_else(|| "Conexão com o banco perdida".to_string())?;

    let mut stmt = conn.prepare("SELECT path, title FROM notes").map_err(|e| e.to_string())?;
    let note_rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;

    let mut nodes_map = std::collections::HashMap::new();
    let mut real_paths = std::collections::HashSet::new();

    for row in note_rows.flatten() {
        let (path, title) = row;
        real_paths.insert(path.clone());
        nodes_map.insert(path, (title, 0));
    }

    let mut stmt = conn.prepare("SELECT source_path, target_name, target_path FROM links").map_err(|e| e.to_string())?;
    let link_rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
    }).map_err(|e| e.to_string())?;

    let mut links = Vec::new();
    let mut phantom_nodes = std::collections::HashMap::new();

    for row in link_rows.flatten() {
        let (source, target_name, target_path) = row;

        if !real_paths.contains(&source) {
            continue;
        }

        let target_id = if let Some(ref path) = target_path {
            if real_paths.contains(path) {
                path.clone()
            } else {
                format!("phantom:{}", target_name)
            }
        } else {
            format!("phantom:{}", target_name)
        };

        links.push(GraphLink {
            source: source.clone(),
            target: target_id.clone(),
        });

        if let Some(entry) = nodes_map.get_mut(&source) {
            entry.1 += 1;
        }

        if target_id.starts_with("phantom:") {
            let p_name = target_name.clone();
            let count = phantom_nodes.entry(p_name).or_insert(0);
            *count += 1;
        } else {
            if let Some(entry) = nodes_map.get_mut(&target_id) {
                entry.1 += 1;
            }
        }
    }

    let mut nodes = Vec::new();
    
    for (path, (title, degree)) in nodes_map {
        nodes.push(GraphNode {
            id: path,
            label: title,
            exists: true,
            degree,
        });
    }

    for (name, degree) in phantom_nodes {
        nodes.push(GraphNode {
            id: format!("phantom:{}", name),
            label: name,
            exists: false,
            degree,
        });
    }

    Ok(GraphData { nodes, links })
}




