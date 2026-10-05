// D1-Q1 (Spec 35): o identifier mudou de `com.mycellia.app` pra `com.mycellia.desktop`,
// e o identifier É o nome da pasta de estado (`app_config_dir`). Na 1ª abertura, copia o
// estado autoral da pasta antiga pra nova. Copia (não move): voltar pra um build antigo
// enxerga a pasta antiga intacta. O índice (`index.db` + `-wal`/`-shm`) NÃO é copiado:
// é descartável e re-deriva dos `.md` (§1.2) — copiar banco WAL aberto corrompe.
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use tauri::Manager;

pub const OLD_IDENTIFIER: &str = "com.mycellia.app";

// `config.json` vai POR ÚLTIMO: ele é o marcador de "migração concluída". Se algo falhar
// antes, a pasta nova fica sem `config.json` e a próxima abertura tenta de novo.
const FILES_IN_ORDER: [&str; 3] = ["graph_positions.json", "personal_dict.txt", "config.json"];

// Mesma escrita atômica do config: .tmp → sync_all → drop → rename
fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    let mut file = File::create(&temp_path)
        .map_err(|e| format!("Falha ao criar temp {}: {e}", temp_path.display()))?;
    file.write_all(content)
        .map_err(|e| format!("Falha ao escrever {}: {e}", temp_path.display()))?;
    file.sync_all()
        .map_err(|e| format!("Falha no sync de {}: {e}", temp_path.display()))?;
    drop(file);
    fs::rename(&temp_path, path)
        .map_err(|e| format!("Falha ao renomear {} (atômico): {e}", path.display()))?;
    Ok(())
}

/// Núcleo puro (testável sem Tauri). `Ok(true)` = migrou; `Ok(false)` = nada a fazer.
pub fn migrate_state_dir(old_dir: &Path, new_dir: &Path) -> Result<bool, String> {
    if new_dir.join("config.json").exists() || !old_dir.join("config.json").exists() {
        return Ok(false);
    }
    fs::create_dir_all(new_dir)
        .map_err(|e| format!("Falha ao criar {}: {e}", new_dir.display()))?;
    for name in FILES_IN_ORDER {
        let src = old_dir.join(name);
        if !src.exists() {
            continue;
        }
        let content =
            fs::read(&src).map_err(|e| format!("Falha ao ler {}: {e}", src.display()))?;
        write_atomic(&new_dir.join(name), &content)?;
    }
    write_atomic(
        &old_dir.join("MIGRATED_TO.txt"),
        new_dir.to_string_lossy().as_bytes(),
    )?;
    Ok(true)
}

/// Chamado no início do `.setup()`, antes de qualquer comando ler config. Fail-soft:
/// qualquer falha só loga, o app sobe normal.
pub fn run<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Ok(new_dir) = app.path().app_config_dir() else {
        eprintln!("migrate_dirs: sem app_config_dir, migração pulada");
        return;
    };
    let Some(parent) = new_dir.parent() else {
        eprintln!("migrate_dirs: app_config_dir sem pasta-pai, migração pulada");
        return;
    };
    let old_dir = parent.join(OLD_IDENTIFIER);
    if old_dir == new_dir {
        return;
    }
    match migrate_state_dir(&old_dir, &new_dir) {
        Ok(true) => eprintln!(
            "migrate_dirs: estado migrado de {} para {}",
            old_dir.display(),
            new_dir.display()
        ),
        Ok(false) => {}
        Err(e) => eprintln!("migrate_dirs: falha na migração (tenta de novo na próxima abertura): {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // Pasta única por teste (pid + contador): nada de nome fixo compartilhado entre testes
    fn unique_root(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "mycellia_migrate_{tag}_{}_{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    // Conteúdos com bytes não-ASCII e sem newline final pra pegar qualquer transformação
    const CONFIG: &[u8] = b"{\n  \"current_vault\": \"/home/x/Cora\xc3\xa7\xc3\xa3o\",\n  \"theme\": \"dark\"\n}";
    const GRAPH: &[u8] = b"{\"a.md\":{\"x\":1.5,\"y\":-2.25}}";
    const DICT: &[u8] = b"mycellia\nuauflow\nfulanetti";

    fn seed_old(old: &Path) {
        fs::create_dir_all(old).unwrap();
        fs::write(old.join("config.json"), CONFIG).unwrap();
        fs::write(old.join("graph_positions.json"), GRAPH).unwrap();
        fs::write(old.join("personal_dict.txt"), DICT).unwrap();
        fs::write(old.join("index.db"), b"SQLite format 3\0").unwrap();
        fs::write(old.join("index.db-wal"), b"wal").unwrap();
        fs::write(old.join("index.db-shm"), b"shm").unwrap();
    }

    fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let mut out: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|e| {
                let e = e.unwrap();
                (e.file_name().to_string_lossy().into_owned(), fs::read(e.path()).unwrap())
            })
            .collect();
        out.sort();
        out
    }

    #[test]
    fn migra_os_tres_arquivos_byte_a_byte_sem_indice_e_antigo_intacto() {
        let root = unique_root("full");
        let (old, new) = (root.join(OLD_IDENTIFIER), root.join("com.mycellia.desktop"));
        seed_old(&old);
        let before = snapshot(&old);

        assert_eq!(migrate_state_dir(&old, &new), Ok(true));

        assert_eq!(fs::read(new.join("config.json")).unwrap(), CONFIG);
        assert_eq!(fs::read(new.join("graph_positions.json")).unwrap(), GRAPH);
        assert_eq!(fs::read(new.join("personal_dict.txt")).unwrap(), DICT);
        // só os 3 arquivos: sem índice, sem .tmp sobrando
        let new_names: Vec<String> = snapshot(&new).into_iter().map(|(n, _)| n).collect();
        assert_eq!(new_names, ["config.json", "graph_positions.json", "personal_dict.txt"]);

        // antigo intacto byte-a-byte + marcador com o caminho novo
        let mut after = snapshot(&old);
        let marker_pos = after.iter().position(|(n, _)| n == "MIGRATED_TO.txt").unwrap();
        let (_, marker) = after.remove(marker_pos);
        assert_eq!(marker, new.to_string_lossy().as_bytes());
        assert_eq!(after, before);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pasta_nova_com_config_nao_faz_nada() {
        let root = unique_root("idem");
        let (old, new) = (root.join(OLD_IDENTIFIER), root.join("com.mycellia.desktop"));
        seed_old(&old);
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join("config.json"), b"{\"theme\":\"light\"}").unwrap();
        let (old_before, new_before) = (snapshot(&old), snapshot(&new));

        assert_eq!(migrate_state_dir(&old, &new), Ok(false));
        assert_eq!(snapshot(&old), old_before);
        assert_eq!(snapshot(&new), new_before);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pasta_antiga_sem_config_nao_faz_nada() {
        let root = unique_root("noconfig");
        let (old, new) = (root.join(OLD_IDENTIFIER), root.join("com.mycellia.desktop"));
        seed_old(&old);
        fs::remove_file(old.join("config.json")).unwrap();
        let old_before = snapshot(&old);

        assert_eq!(migrate_state_dir(&old, &new), Ok(false));
        assert!(!new.exists());
        assert_eq!(snapshot(&old), old_before);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn falha_no_meio_deixa_pasta_nova_sem_config_e_retenta() {
        let root = unique_root("partial");
        let (old, new) = (root.join(OLD_IDENTIFIER), root.join("com.mycellia.desktop"));
        seed_old(&old);
        // injeta falha de leitura no 2º arquivo da fila (diretório no lugar do arquivo)
        fs::remove_file(old.join("personal_dict.txt")).unwrap();
        fs::create_dir(old.join("personal_dict.txt")).unwrap();

        assert!(migrate_state_dir(&old, &new).is_err());
        assert!(!new.join("config.json").exists());
        assert!(!old.join("MIGRATED_TO.txt").exists());

        // causa removida → próxima abertura conclui
        fs::remove_dir(old.join("personal_dict.txt")).unwrap();
        fs::write(old.join("personal_dict.txt"), DICT).unwrap();
        assert_eq!(migrate_state_dir(&old, &new), Ok(true));
        assert_eq!(fs::read(new.join("config.json")).unwrap(), CONFIG);
        assert_eq!(fs::read(new.join("personal_dict.txt")).unwrap(), DICT);

        let _ = fs::remove_dir_all(&root);
    }
}
