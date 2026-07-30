// E3 (Spec 32): corretor ortográfico 100% local — motor Hunspell-like puro Rust
// (`spellbook`, port do Nuspell) com pt-BR (VERO) + en-US embarcados no binário
// (licenças em dicts/NOTICE.md). Palavra é VÁLIDA se passar em QUALQUER dicionário
// ou no dicionário pessoal (decisão da spec: app open source distribuído nas duas
// línguas + vault real mistura PT com termos técnicos EN).
// Contrato com o front: ele manda só o VOCABULÁRIO do viewport (nunca a nota
// inteira) e cacheia o veredito por palavra; sugestão é sob demanda (menu).
// Dicionário pessoal mora FORA do vault (AppData, §1.3 — vault 100% puro) com a
// mesma escrita atômica do config (.tmp → sync_all → rename).
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};
use tauri::AppHandle;
#[cfg(not(test))]
use tauri::Manager;

const PT_BR_AFF: &str = include_str!("../../dicts/pt_BR.aff");
const PT_BR_DIC: &str = include_str!("../../dicts/pt_BR.dic");
const EN_US_AFF: &str = include_str!("../../dicts/en_US.aff");
const EN_US_DIC: &str = include_str!("../../dicts/en_US.dic");

// Carrega 1x por processo (spike: pt ~440ms + en ~20ms). Comandos Tauri rodam fora
// da main thread, então nem o primeiro check trava a UI — e o warmup do boot
// esconde até essa primeira espera.
fn dictionaries() -> &'static Vec<spellbook::Dictionary> {
    static DICTS: OnceLock<Vec<spellbook::Dictionary>> = OnceLock::new();
    DICTS.get_or_init(|| {
        [(PT_BR_AFF, PT_BR_DIC), (EN_US_AFF, EN_US_DIC)]
            .iter()
            .filter_map(|(aff, dic)| {
                // O VERO vem com BOM — o parser não pode ver o \u{feff}
                spellbook::Dictionary::new(
                    aff.trim_start_matches('\u{feff}'),
                    dic.trim_start_matches('\u{feff}'),
                )
                .map_err(|e| eprintln!("spellcheck: falha ao carregar dicionário: {e}"))
                .ok()
            })
            .collect()
    })
}

fn known_by_dictionaries(word: &str) -> bool {
    dictionaries().iter().any(|d| d.check(word))
}

// ── Dicionário pessoal (comparação case-insensitive: guarda lowercase) ──

fn personal_words() -> &'static RwLock<HashSet<String>> {
    static WORDS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();
    WORDS.get_or_init(|| RwLock::new(HashSet::new()))
}

fn personal_dict_path<R: tauri::Runtime>(_app: &AppHandle<R>) -> Option<PathBuf> {
    #[cfg(test)]
    {
        let thread_id = format!("{:?}", std::thread::current().id())
            .replace("ThreadId(", "")
            .replace(")", "")
            .replace(" ", "");
        let path = std::env::temp_dir().join(format!("mycellia_test_spell_{}", thread_id));
        let _ = fs::create_dir_all(&path);
        Some(path.join("personal_dict.txt"))
    }
    #[cfg(not(test))]
    {
        let path = _app.path().app_config_dir().ok()?;
        let _ = fs::create_dir_all(&path);
        Some(path.join("personal_dict.txt"))
    }
}

fn load_personal_from(path: &Path) -> HashSet<String> {
    let mut set = HashSet::new();
    if let Ok(content) = fs::read_to_string(path) {
        for line in content.lines() {
            let w = line.trim();
            if !w.is_empty() {
                set.insert(w.to_lowercase());
            }
        }
    }
    set
}

// Regrava o arquivo inteiro, ordenado, com a MESMA escrita atômica do config
fn persist_personal(path: &Path, set: &HashSet<String>) -> Result<(), String> {
    let mut words: Vec<&String> = set.iter().collect();
    words.sort();
    let content = words
        .iter()
        .map(|w| w.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";

    let temp_path = path.with_extension("tmp");
    let mut file = File::create(&temp_path)
        .map_err(|e| format!("Falha ao criar temp do dicionário pessoal: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Falha ao escrever dicionário pessoal: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Falha no sync do dicionário pessoal: {e}"))?;
    drop(file);
    fs::rename(&temp_path, path)
        .map_err(|e| format!("Falha ao renomear dicionário pessoal (atômico): {e}"))?;
    Ok(())
}

fn ensure_personal_loaded<R: tauri::Runtime>(app: &AppHandle<R>) {
    static LOADED: OnceLock<()> = OnceLock::new();
    LOADED.get_or_init(|| {
        if let Some(path) = personal_dict_path(app) {
            let loaded = load_personal_from(&path);
            if !loaded.is_empty() {
                if let Ok(mut set) = personal_words().write() {
                    set.extend(loaded);
                }
            }
        }
    });
}

// ── Comandos ──

/// Aquece o load dos dicionários no boot (fire-and-forget do front)
#[tauri::command]
pub fn spellcheck_warmup() {
    let _ = dictionaries();
}

/// Veredito em lote: `true` = palavra conhecida (dicionários OU pessoal)
#[tauri::command]
pub fn check_words<R: tauri::Runtime>(app: AppHandle<R>, words: Vec<String>) -> Vec<bool> {
    ensure_personal_loaded(&app);
    let personal = personal_words().read();
    words
        .iter()
        .map(|w| {
            let in_personal = personal
                .as_ref()
                .map(|set| set.contains(&w.to_lowercase()))
                .unwrap_or(false);
            in_personal || known_by_dictionaries(w)
        })
        .collect()
}

/// Sugestões sob demanda (menu de contexto): pt-BR primeiro, depois en-US, teto 5
#[tauri::command]
pub fn suggest_word(word: String) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for dict in dictionaries() {
        let mut sug = Vec::new();
        dict.suggest(&word, &mut sug);
        for s in sug {
            if !out.contains(&s) {
                out.push(s);
                if out.len() >= 5 {
                    return out;
                }
            }
        }
    }
    out
}

/// "Adicionar ao dicionário": entra no set em memória + persiste atômico no AppData
#[tauri::command]
pub fn add_personal_word<R: tauri::Runtime>(app: AppHandle<R>, word: String) -> Result<(), String> {
    ensure_personal_loaded(&app);
    let w = word.trim().to_lowercase();
    if w.is_empty() {
        return Err("Palavra vazia".to_string());
    }
    {
        let mut set = personal_words()
            .write()
            .map_err(|e| format!("Lock do dicionário pessoal: {e}"))?;
        if !set.insert(w) {
            return Ok(()); // já existia — nada a persistir
        }
    }
    let path = personal_dict_path(&app).ok_or("Sem diretório de config".to_string())?;
    let set = personal_words()
        .read()
        .map_err(|e| format!("Lock do dicionário pessoal: {e}"))?;
    persist_personal(&path, &set)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dicionarios_carregam_e_checam_pt_e_en() {
        let dicts = dictionaries();
        assert_eq!(dicts.len(), 2, "pt_BR e en_US precisam carregar");
        for w in ["coração", "distribuição", "paralelepípedo", "knowledge", "running"] {
            assert!(known_by_dictionaries(w), "'{w}' deveria ser válida");
        }
        for w in ["coraçao", "qeuijo", "knowlege", "errrado"] {
            assert!(!known_by_dictionaries(w), "'{w}' deveria ser inválida");
        }
    }

    #[test]
    fn sugestoes_acertam_o_alvo_e_respeitam_o_teto() {
        let s = suggest_word("qeuijo".to_string());
        assert!(s.contains(&"queijo".to_string()), "esperava 'queijo' em {s:?}");
        let s = suggest_word("knowlege".to_string());
        assert!(s.contains(&"knowledge".to_string()), "esperava 'knowledge' em {s:?}");
        assert!(s.len() <= 5);
    }

    #[test]
    fn dicionario_pessoal_persiste_atomico_e_recarrega() {
        let dir = std::env::temp_dir().join(format!(
            "mycellia_spell_persist_{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("personal_dict.txt");
        let _ = fs::remove_file(&path);

        let mut set = HashSet::new();
        set.insert("mycellia".to_string());
        set.insert("uauflow".to_string());
        persist_personal(&path, &set).expect("persistência atômica");

        // arquivo ordenado, uma palavra por linha, sem .tmp sobrando
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, "mycellia\nuauflow\n");
        assert!(!path.with_extension("tmp").exists());

        // recarrega do disco (normaliza lowercase)
        let reloaded = load_personal_from(&path);
        assert!(reloaded.contains("mycellia"));
        assert!(reloaded.contains("uauflow"));
        assert_eq!(reloaded.len(), 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn palavra_pessoal_vale_como_conhecida_no_fluxo_de_check() {
        // fluxo direto sobre o estado em memória (sem AppHandle): o comando
        // check_words consulta este mesmo set
        {
            let mut set = personal_words().write().unwrap();
            set.insert("fulanetti".to_string());
        }
        let personal = personal_words().read().unwrap();
        assert!(personal.contains(&"Fulanetti".to_lowercase()));
        assert!(!known_by_dictionaries("fulanetti"), "não deve estar nos dicionários");
    }
}
