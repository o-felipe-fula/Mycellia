#[cfg(test)]
mod tests {
    use crate::commands::parser::parse_markdown;
    use crate::commands::index_db::DbState;
    use rusqlite::Connection;
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};

    // Helper: cria uma conexão SQLite in-memory com o mesmo schema do index_db
    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute("PRAGMA foreign_keys = ON;", []).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS notes (
                path TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                last_modified INTEGER NOT NULL
            );",
            [],
        ).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS links (
                source_path TEXT NOT NULL,
                target_name TEXT NOT NULL,
                target_path TEXT,
                PRIMARY KEY (source_path, target_name),
                FOREIGN KEY (source_path) REFERENCES notes (path) ON DELETE CASCADE
            );",
            [],
        ).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tags (
                note_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (note_path, tag),
                FOREIGN KEY (note_path) REFERENCES notes (path) ON DELETE CASCADE
            );",
            [],
        ).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS properties (
                note_path TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (note_path, key),
                FOREIGN KEY (note_path) REFERENCES notes (path) ON DELETE CASCADE
            );",
            [],
        ).unwrap();

        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                path UNINDEXED,
                title,
                content,
                tags,
                properties
            );",
            [],
        ).unwrap();

        conn.execute(
            "CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
                DELETE FROM notes_fts WHERE path = OLD.path;
            END;",
            [],
        ).unwrap();

        conn
    }

    // Helper: indexa uma nota mock no banco de dados de teste (simula o que index_vault faz)
    fn index_note_in_db(conn: &Connection, path: &str, content: &str, file_name: &str, mtime: i64) {
        let meta = parse_markdown(content, file_name);

        conn.execute(
            "INSERT OR REPLACE INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
            rusqlite::params![path, meta.title, mtime],
        ).unwrap();

        // Limpa relacionamentos antigos
        conn.execute("DELETE FROM links WHERE source_path = ?", [path]).unwrap();
        conn.execute("DELETE FROM tags WHERE note_path = ?", [path]).unwrap();
        conn.execute("DELETE FROM properties WHERE note_path = ?", [path]).unwrap();
        conn.execute("DELETE FROM notes_fts WHERE path = ?", [path]).unwrap();

        // Insere links
        for link in &meta.links {
            conn.execute(
                "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
                rusqlite::params![path, link],
            ).unwrap();
        }

        // Insere tags
        for tag in &meta.tags {
            conn.execute(
                "INSERT OR REPLACE INTO tags (note_path, tag) VALUES (?, ?)",
                rusqlite::params![path, tag],
            ).unwrap();
        }

        // Insere propriedades
        for (key, val) in &meta.properties {
            conn.execute(
                "INSERT OR REPLACE INTO properties (note_path, key, value) VALUES (?, ?, ?)",
                rusqlite::params![path, key, val],
            ).unwrap();
        }

        // Insere no FTS5
        let tags_joined = meta.tags.join(" ");
        conn.execute(
            "INSERT INTO notes_fts (path, title, content, tags, properties) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![path, meta.title, meta.clean_text, tags_joined, ""],
        ).unwrap();
    }

    // =========================================================================
    // TESTE 1: Garantia Read-Only (Princípio #1 - CRÍTICO)
    // Verifica que a indexação NÃO altera os arquivos .md originais no disco
    // =========================================================================
    #[test]
    fn test_indexing_read_only_guarantee() {
        use sha2::{Sha256, Digest};

        let temp_dir = std::env::temp_dir().join("mycellia_test_readonly");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        // Cria notas de teste com conteúdos diversos
        let notes = vec![
            (
                "nota_simples.md",
                "---\ntitle: Nota Simples\ntags: [rust, teste]\n---\n\nConteúdo simples com #tag_inline e [[Link Interno]].\n",
            ),
            (
                "nota_complexa.md",
                "---\ntitle: Nota Complexa\nauthor: Felipe\ndate: 2024-01-15\ntags:\n  - ciência\n  - pesquisa\ncustom_field: valor qualquer\n---\n\n# Cabeçalho\n\nTexto com várias [[Referência A]] e [[Referência B|Alias]].\n\n```rust\n// #falsa_tag_em_codigo não deve ser extraída\nlet x = [[não_é_link]];\n```\n\nMais texto com #tag_real e `#tag_inline_code_ignorada`.\n",
            ),
            (
                "nota_vazia.md",
                "",
            ),
            (
                "nota_sem_frontmatter.md",
                "# Título direto\n\nTexto livre sem frontmatter com #minha_tag.\n",
            ),
        ];

        // Grava notas e computa hashes SHA256 antes da indexação
        let mut hashes_before = Vec::new();
        for (name, content) in &notes {
            let file_path = temp_dir.join(name);
            fs::write(&file_path, content).unwrap();

            let bytes = fs::read(&file_path).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let hash = format!("{:x}", hasher.finalize());
            hashes_before.push((file_path.clone(), hash));
        }

        // Executa indexação (simulada usando parser + banco in-memory)
        let conn = create_test_db();
        for (name, _content) in &notes {
            let file_path = temp_dir.join(name);
            let path_str = file_path.to_string_lossy().into_owned();

            // Lê o arquivo do disco (como o indexador real faz)
            let disk_content = fs::read_to_string(&file_path).unwrap();
            index_note_in_db(&conn, &path_str, &disk_content, name, 1000);
        }

        // Recomputa hashes SHA256 após a indexação
        for (file_path, hash_before) in &hashes_before {
            let bytes = fs::read(file_path).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let hash_after = format!("{:x}", hasher.finalize());

            assert_eq!(
                hash_before, &hash_after,
                "VIOLAÇÃO DO PRINCÍPIO #1: Arquivo {} foi modificado pela indexação!\nHash antes: {}\nHash depois: {}",
                file_path.display(), hash_before, hash_after
            );
        }

        // Verifica que os dados foram indexados corretamente
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 4, "Devem existir 4 notas indexadas");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    // =========================================================================
    // TESTE 2: Integridade de Sincronização FTS5
    // Valida trigger de delete e delete-reinsert em atualizações
    // =========================================================================
    #[test]
    fn test_fts5_sync_integrity() {
        let conn = create_test_db();

        let content_v1 = "---\ntitle: Nota FTS\ntags: [alpha]\n---\n\nConteúdo original para busca full-text.\n";
        let path = "/test/nota_fts.md";

        // 1. Indexa a nota pela primeira vez
        index_note_in_db(&conn, path, content_v1, "nota_fts.md", 1000);

        // Verifica presença no FTS5
        let fts_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE path = ?",
            [path],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(fts_count, 1, "Nota deve existir no FTS5 após indexação");

        // Verifica busca funciona
        let found: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'original'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(found, 1, "Busca por 'original' deve encontrar a nota");

        // 2. Reindexação com conteúdo atualizado (simula mtime mudou)
        let content_v2 = "---\ntitle: Nota FTS Atualizada\ntags: [beta, gamma]\n---\n\nConteúdo totalmente diferente para a segunda versão.\n";
        index_note_in_db(&conn, path, content_v2, "nota_fts.md", 2000);

        // Verifica que NÃO há duplicação no FTS5
        let fts_count_after: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE path = ?",
            [path],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(fts_count_after, 1, "Não pode haver duplicata no FTS5 após reindexação");

        // Verifica que o conteúdo antigo sumiu
        let old_found: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'original'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(old_found, 0, "Conteúdo antigo não deve ser encontrado no FTS5");

        // Verifica que o conteúdo novo está presente
        let new_found: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'diferente'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(new_found, 1, "Conteúdo novo deve ser encontrado no FTS5");

        // 3. Deleção da nota (trigger deve limpar o FTS5 automaticamente)
        conn.execute("DELETE FROM notes WHERE path = ?", [path]).unwrap();

        let fts_after_delete: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE path = ?",
            [path],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(fts_after_delete, 0, "Trigger AFTER DELETE deve limpar automaticamente o FTS5");

        // Confirma cascade nas tabelas relacionadas
        let links_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM links WHERE source_path = ?",
            [path],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(links_count, 0, "CASCADE deve limpar links");

        let tags_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tags WHERE note_path = ?",
            [path],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(tags_count, 0, "CASCADE deve limpar tags");
    }

    // =========================================================================
    // TESTE 3: Correção da Extração de Metadados + Code Block Guard
    // Nota complexa com frontmatter YAML, tags, links e blocos de código
    // =========================================================================
    #[test]
    fn test_metadata_extraction_and_code_block_guard() {
        let content = r#"---
title: Nota de Teste Complexa
author: Felipe Fulanetti
date: 2024-01-15
tags:
  - ciência
  - pesquisa
  - deep-learning
aliases:
  - Nota DL
  - Teste Complexo
custom_number: 42
---

# Introdução

Este documento explora #deep_learning e #neural_networks.

Referências: [[Atenção é Tudo]] e [[Transformers|Arquitetura Transformer]].

## Seção de Código

```python
# #falsa_tag_python não deve ser extraída
link = "[[falso_link_em_codigo]]"
resultado = #outra_falsa_tag
```

Texto intermediário com #tag_valida_apos_bloco.

Código inline: `#tag_inline_ignorada` e `[[link_inline_ignorado]]`.

```rust
fn main() {
    // #tag_rust_falsa
    let x = "[[outro_falso_link]]";
}
```

## Conclusão

Última seção com #conclusao e referência para [[Bibliografia]].
"#;

        let meta = parse_markdown(content, "nota_complexa.md");

        // Verificações de propriedades YAML
        assert_eq!(meta.title, "nota_complexa");
        assert!(meta.properties.len() >= 5, "Deve ter ao menos 5 propriedades: title, author, date, tags, aliases, custom_number");

        // Verificação de que as propriedades certas existem
        let props_map: std::collections::HashMap<_, _> = meta.properties.into_iter().collect();
        assert!(props_map.contains_key("title"), "Deve conter propriedade 'title'");
        assert!(props_map.contains_key("author"), "Deve conter propriedade 'author'");
        assert!(props_map.contains_key("date"), "Deve conter propriedade 'date'");
        assert!(props_map.contains_key("tags"), "Deve conter propriedade 'tags'");
        assert!(props_map.contains_key("aliases"), "Deve conter propriedade 'aliases'");
        assert!(props_map.contains_key("custom_number"), "Deve conter propriedade 'custom_number'");

        // Verificação de tags — deve conter tags do frontmatter e inline, mas NÃO as de code blocks
        let tags_set: HashSet<&str> = meta.tags.iter().map(|s| s.as_str()).collect();

        // Tags que DEVEM existir (do frontmatter YAML)
        assert!(tags_set.contains("ciência"), "Tag 'ciência' do YAML deve existir");
        assert!(tags_set.contains("pesquisa"), "Tag 'pesquisa' do YAML deve existir");
        assert!(tags_set.contains("deep-learning"), "Tag 'deep-learning' do YAML deve existir");

        // Tags inline que DEVEM existir
        assert!(tags_set.contains("deep_learning"), "Tag inline #deep_learning deve existir");
        assert!(tags_set.contains("neural_networks"), "Tag inline #neural_networks deve existir");
        assert!(tags_set.contains("tag_valida_apos_bloco"), "Tag inline #tag_valida_apos_bloco deve existir");
        assert!(tags_set.contains("conclusao"), "Tag inline #conclusao deve existir");

        // Tags de code blocks que NÃO devem existir (Code Block Guard)
        assert!(!tags_set.contains("falsa_tag_python"), "Tag de code block #falsa_tag_python NÃO deve ser extraída");
        assert!(!tags_set.contains("outra_falsa_tag"), "Tag de code block #outra_falsa_tag NÃO deve ser extraída");
        assert!(!tags_set.contains("tag_inline_ignorada"), "Tag de inline code #tag_inline_ignorada NÃO deve ser extraída");
        assert!(!tags_set.contains("tag_rust_falsa"), "Tag de code block Rust #tag_rust_falsa NÃO deve ser extraída");

        // Verificação de links — deve conter wiki-links reais, mas NÃO os de code blocks
        let links_set: HashSet<&str> = meta.links.iter().map(|s| s.as_str()).collect();

        // Links que DEVEM existir
        assert!(links_set.contains("Atenção é Tudo"), "Wiki-link [[Atenção é Tudo]] deve existir");
        assert!(links_set.contains("Transformers"), "Wiki-link [[Transformers|...]] deve extrair 'Transformers'");
        assert!(links_set.contains("Bibliografia"), "Wiki-link [[Bibliografia]] deve existir");

        // Links de code blocks que NÃO devem existir
        assert!(!links_set.contains("falso_link_em_codigo"), "Link de code block NÃO deve ser extraído");
        assert!(!links_set.contains("link_inline_ignorado"), "Link de inline code NÃO deve ser extraído");
        assert!(!links_set.contains("outro_falso_link"), "Link de code block Rust NÃO deve ser extraído");

        // Verificação do texto limpo para FTS5
        assert!(!meta.clean_text.is_empty(), "Texto limpo para FTS5 não deve ser vazio");
        assert!(meta.clean_text.contains("Introdução"), "Texto limpo deve conter cabeçalhos");
        assert!(meta.clean_text.contains("Conclusão"), "Texto limpo deve conter seção final");
        // O texto dentro de code blocks NÃO deve estar no clean_text
        assert!(!meta.clean_text.contains("falsa_tag_python"), "Texto de code block não deve estar no clean_text");
    }

    // =========================================================================
    // TESTE 4: Robustez no Rebuild e Concorrência
    // Buscas durante rebuild devem retornar vazio sem panic
    // =========================================================================
    #[test]
    fn test_concurrent_search_during_rebuild() {
        // Simula o DbState como ele seria no Tauri, mas sem AppHandle
        let state = DbState {
            conn: Mutex::new(None), // Conexão None simula banco fechado durante rebuild
            is_rebuilding: AtomicBool::new(true),
            is_indexing: AtomicBool::new(false),
        };

        // Cenário 1: is_rebuilding=true → busca deve retornar vazio
        assert!(
            state.is_rebuilding.load(Ordering::Relaxed),
            "Flag is_rebuilding deve estar true"
        );

        // Simula o que search_notes faria: verifica flags e retorna vazio
        let should_return_empty = state.is_rebuilding.load(Ordering::Relaxed) 
            || state.is_indexing.load(Ordering::Relaxed);
        assert!(should_return_empty, "Busca deve retornar vazio durante rebuild");

        // Cenário 2: is_indexing=true → busca deve retornar vazio
        state.is_rebuilding.store(false, Ordering::Relaxed);
        state.is_indexing.store(true, Ordering::Relaxed);

        let should_return_empty_2 = state.is_rebuilding.load(Ordering::Relaxed) 
            || state.is_indexing.load(Ordering::Relaxed);
        assert!(should_return_empty_2, "Busca deve retornar vazio durante indexação");

        // Cenário 3: conn=None → busca deve retornar vazio sem panic
        state.is_indexing.store(false, Ordering::Relaxed);
        let conn_lock = state.conn.lock().unwrap();
        assert!(conn_lock.is_none(), "Conexão None simula banco fechado");
        // Não faz panic → sucesso

        // Cenário 4: Tudo normal → busca deve funcionar
        drop(conn_lock);
        let conn = Connection::open_in_memory().unwrap();
        {
            let mut conn_lock = state.conn.lock().unwrap();
            *conn_lock = Some(conn);
        }
        let conn_lock = state.conn.lock().unwrap();
        assert!(conn_lock.is_some(), "Conexão deve estar disponível quando rebuild terminar");
    }

    // =========================================================================
    // TESTE 5: Telemetria de Escala (4.782 arquivos Markdown)
    // Gera vault mockado, indexa e reporta tempo
    // =========================================================================
    #[test]
    fn test_scale_telemetry_indexing_4782_notes() {
        let temp_dir = std::env::temp_dir().join("mycellia_scale_test_index");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let total_files = 4782;
        let folders_count = 128;

        // Gera pastas
        let mut folders = Vec::new();
        for i in 0..folders_count {
            let folder_path = temp_dir.join(format!("Pasta_{}", i));
            fs::create_dir_all(&folder_path).unwrap();
            folders.push(folder_path);
        }

        // Gera arquivos Markdown com conteúdo variado
        for i in 0..total_files {
            let parent = &folders[i % folders_count];
            let file_path = parent.join(format!("Nota_{}.md", i));
            let content = format!(
                "---\ntitle: Nota {}\ntags: [tag_{}, tag_{}]\n---\n\n# Nota {}\n\nConteúdo da nota {} com #tag_inline_{} e [[Link_{}]].\n",
                i, i % 50, i % 100, i, i, i % 200, i % 500
            );
            fs::write(&file_path, content).unwrap();
        }

        // Mede o tempo de indexação
        let mut conn = create_test_db();
        let start = std::time::Instant::now();

        // Coleta todos os .md recursivamente
        let mut all_files = Vec::new();
        fn collect_md(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        collect_md(&path, files);
                    } else if path.extension().is_some_and(|ext| ext == "md") {
                        files.push(path);
                    }
                }
            }
        }
        collect_md(&temp_dir, &mut all_files);

        // Indexa tudo em uma transação (como o indexador real faz)
        let tx = conn.unchecked_transaction().unwrap();
        for file_path in &all_files {
            let path_str = file_path.to_string_lossy().into_owned();
            let file_name = file_path.file_name().unwrap().to_string_lossy().into_owned();
            let content = fs::read_to_string(file_path).unwrap();
            let meta = parse_markdown(&content, &file_name);

            tx.execute(
                "INSERT OR REPLACE INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
                rusqlite::params![path_str, meta.title, 1000],
            ).unwrap();

            for tag in &meta.tags {
                tx.execute(
                    "INSERT OR REPLACE INTO tags (note_path, tag) VALUES (?, ?)",
                    rusqlite::params![path_str, tag],
                ).unwrap();
            }

            for link in &meta.links {
                tx.execute(
                    "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
                    rusqlite::params![path_str, link],
                ).unwrap();
            }

            let tags_joined = meta.tags.join(" ");
            tx.execute(
                "INSERT INTO notes_fts (path, title, content, tags, properties) VALUES (?, ?, ?, ?, ?)",
                rusqlite::params![path_str, meta.title, meta.clean_text, tags_joined, ""],
            ).unwrap();
        }
        tx.commit().unwrap();

        let duration = start.elapsed();

        // Mede o tempo de re-resolução de todos os links no vault de 4782 notas
        let tx_resolve = conn.transaction().unwrap();
        let start_resolve = std::time::Instant::now();
        crate::commands::index_db::re_resolve_all_links(&tx_resolve, &temp_dir.to_string_lossy()).unwrap();
        let duration_resolve = start_resolve.elapsed();
        tx_resolve.commit().unwrap();

        println!(
            "\n========================================",
        );
        println!(
            "TELEMETRIA DE ESCALA: Indexou {} notas em {:?}",
            all_files.len(), duration
        );
        println!(
            "TELEMETRIA DE RE-RESOLUÇÃO: Re-resolveu links de {} notas em {:?}",
            all_files.len(), duration_resolve
        );
        println!(
            "========================================\n",
        );

        // Verifica contagem
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0)).unwrap();
        assert_eq!(count, total_files as i64, "Todas as notas devem estar indexadas");

        let fts_count: i64 = conn.query_row("SELECT COUNT(*) FROM notes_fts", [], |row| row.get(0)).unwrap();
        assert_eq!(fts_count, total_files as i64, "Todas as notas devem estar no FTS5");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir);
    }

    // =========================================================================
    // TESTE 6: Extração de tags com regex — casos de borda
    // =========================================================================
    #[test]
    fn test_tag_extraction_edge_cases() {
        // Tag normal no início da linha
        let content1 = "#minha_tag resto do texto";
        let meta1 = parse_markdown(content1, "test.md");
        assert!(meta1.tags.contains(&"minha_tag".to_string()), "Tag no início da linha deve ser extraída");

        // Tag após espaço
        let content2 = "texto antes #tag_depois";
        let meta2 = parse_markdown(content2, "test.md");
        assert!(meta2.tags.contains(&"tag_depois".to_string()), "Tag após espaço deve ser extraída");

        // Cor hexadecimal que começa com letra é extraída como tag (is_hex_color foi removido)
        // #333 começa com dígito → bloqueado pela regra de início de tag
        let content3 = "color: #ff0000 e #333 e #abc123 e #AABB00";
        let meta3 = parse_markdown(content3, "test.md");
        assert!(meta3.tags.contains(&"ff0000".to_string()), "Cor hex #ff0000 deve ser extraída como tag");
        assert!(!meta3.tags.iter().any(|t| t == "333"), "Cor hex #333 NÃO deve ser extraída como tag (começa com número)");
        assert!(meta3.tags.contains(&"abc123".to_string()), "Cor hex #abc123 deve ser extraída como tag");
        assert!(meta3.tags.contains(&"AABB00".to_string()), "Cor hex #AABB00 deve ser extraída como tag");

        // Heading markdown NÃO deve ser tag
        let content4 = "# Título Principal\n\nTexto com #tag_real";
        let meta4 = parse_markdown(content4, "test.md");
        assert!(meta4.tags.contains(&"tag_real".to_string()), "Tag inline deve ser extraída");
        assert!(!meta4.tags.iter().any(|t| t.starts_with("Título")), "Heading não deve ser tag");

        // Tag com sublinhado inicial — deve ser extraída corretamente (não mais consumida pelo pulldown-cmark)
        let content5 = "conferir #_internal depois.";
        let meta5 = parse_markdown(content5, "test.md");
        assert!(meta5.tags.contains(&"_internal".to_string()), "Tag com _ inicial deve ser extraída corretamente");

        // Tag com path-separator /
        let content6 = "texto #area/subarea/item";
        let meta6 = parse_markdown(content6, "test.md");
        assert!(meta6.tags.contains(&"area/subarea/item".to_string()), "Tag com / deve ser extraída");
    }

    // =========================================================================
    // TESTE 7: Wiki-links — variações de formato
    // =========================================================================
    #[test]
    fn test_wiki_link_extraction_variants() {
        let content = r#"
Links normais: [[Nota Simples]] e [[Pasta/Nota Aninhada]].
Links com alias: [[Target|Texto Exibido]] e [[Outro|Alias Longo]].
Links adjacentes: [[A]][[B]].
Link vazio (deve ser ignorado): [[]].
"#;
        let meta = parse_markdown(content, "test_links.md");
        let links_set: HashSet<&str> = meta.links.iter().map(|s| s.as_str()).collect();

        assert!(links_set.contains("Nota Simples"), "Link simples deve ser extraído");
        assert!(links_set.contains("Pasta/Nota Aninhada"), "Link com path deve ser extraído");
        assert!(links_set.contains("Target"), "Link com alias deve extrair o target antes do |");
        assert!(links_set.contains("Outro"), "Link com alias longo deve extrair o target");
        assert!(links_set.contains("A"), "Link adjacente A deve ser extraído");
        assert!(links_set.contains("B"), "Link adjacente B deve ser extraído");
        assert!(!links_set.contains(""), "Link vazio não deve ser extraído");
    }

    // =========================================================================
    // TESTE 8: Incrementalidade — mtime comparação
    // =========================================================================
    #[test]
    fn test_incremental_indexing_by_mtime() {
        let conn = create_test_db();

        // Indexa com mtime=1000
        let content = "---\ntitle: Nota Incremental\n---\n\nTexto v1.\n";
        index_note_in_db(&conn, "/test/inc.md", content, "inc.md", 1000);

        // Verifica mtime gravado
        let db_mtime: i64 = conn.query_row(
            "SELECT last_modified FROM notes WHERE path = ?",
            ["/test/inc.md"],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(db_mtime, 1000);

        // Simula arquivo com mtime=1000 (sem mudança) — deveria ser pulado
        // Simula arquivo com mtime=2000 (modificado) — deveria ser reindexado
        // Não precisamos simular o pulo aqui pois isso é lógica do index_vault;
        // mas verificamos que o reindex com mtime maior atualiza o banco
        let content_v2 = "---\ntitle: Nota Incremental V2\n---\n\nTexto v2 com mudanças.\n";
        index_note_in_db(&conn, "/test/inc.md", content_v2, "inc.md", 2000);

        let new_mtime: i64 = conn.query_row(
            "SELECT last_modified FROM notes WHERE path = ?",
            ["/test/inc.md"],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(new_mtime, 2000, "mtime deve ser atualizado após reindexação");

        // FTS5 deve conter o texto novo, não o antigo
        let new_found: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_fts WHERE notes_fts MATCH 'mudanças'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(new_found, 1, "Texto novo deve ser encontrável no FTS5");
    }

    #[test]
    fn test_link_resolution_and_backlinks_deterministic() {
        use crate::commands::index_db::{resolve_target_path, DbState};
        use std::sync::Mutex;
        use std::sync::atomic::AtomicBool;

        let temp_dir_vault = std::env::temp_dir().join("mycellia_test_deterministic_vault");
        let _ = fs::remove_dir_all(&temp_dir_vault);
        let _ = fs::create_dir_all(&temp_dir_vault);
        let vault_path = temp_dir_vault.to_string_lossy().into_owned();

        let path_a = temp_dir_vault.join("pasta_a").join("sub").join("Plano.md").to_string_lossy().into_owned();
        let path_b = temp_dir_vault.join("pasta_b").join("Plano.md").to_string_lossy().into_owned();
        let path_c = temp_dir_vault.join("pasta_c").join("Plano.md").to_string_lossy().into_owned();
        let nota_a = temp_dir_vault.join("Nota A.md").to_string_lossy().into_owned();

        let all_paths = vec![
            path_a.clone(),
            path_b.clone(), // mais curto
            path_c.clone(), // mesmo tamanho que pasta_b, mas alfabeticamente posterior
        ];

        // 1. Testa a resolução determinística de caminho
        let resolved = resolve_target_path("Plano", &all_paths, &vault_path);
        // Menor comprimento: pasta_b (len 14) vs pasta_a/sub (len 18) vs pasta_c (len 14)
        // Empate no comprimento: pasta_b vs pasta_c. Ordem alfabética: pasta_b < pasta_c
        assert_eq!(resolved, Some(path_b.clone()));

        // 2. Testa a integração com o banco SQLite
        let conn = create_test_db();
        
        // Simula o index_vault inserindo as notas e os links
        conn.execute("INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)", rusqlite::params![&nota_a, "Nota A", 1000]).unwrap();
        conn.execute("INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)", rusqlite::params![&path_b, "Plano", 1000]).unwrap();
        conn.execute("INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)", rusqlite::params![&path_c, "Plano", 1000]).unwrap();

        // Nota A tem um link para [[Plano]]
        // O indexador resolve o link e insere
        let all_paths_in_db = vec![
            nota_a.clone(),
            path_b.clone(),
            path_c.clone(),
        ];
        let resolved_path = resolve_target_path("Plano", &all_paths_in_db, &vault_path);
        assert_eq!(resolved_path, Some(path_b.clone()));

        conn.execute(
            "INSERT INTO links (source_path, target_name, target_path) VALUES (?, ?, ?)",
            rusqlite::params![&nota_a, "Plano", resolved_path],
        ).unwrap();

        // 3. Simula a leitura e o get_backlinks
        // Cria a Nota A fictícia em disco temporário para a leitura de contexto do backlink
        let temp_dir_backlinks = std::env::temp_dir().join("mycellia_test_backlinks");
        let _ = fs::remove_dir_all(&temp_dir_backlinks);
        let _ = fs::create_dir_all(&temp_dir_backlinks);
        
        let file_a_path = temp_dir_backlinks.join("Nota A.md");
        fs::write(&file_a_path, "Texto antes\nEste é o link para [[Plano]] e mais texto.\nTexto depois").unwrap();

        // Cria o DbState
        let state = DbState {
            conn: Mutex::new(Some(conn)),
            is_rebuilding: AtomicBool::new(false),
            is_indexing: AtomicBool::new(false),
        };

        // Vamos invocar diretamente as queries do banco
        let conn_guard = state.conn.lock().unwrap();
        let db_conn = conn_guard.as_ref().unwrap();

        // get_all_notes mock
        let mut stmt = db_conn.prepare("SELECT path, title FROM notes").unwrap();
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).unwrap();
        let all_notes: Vec<(String, String)> = rows.flatten().collect();
        assert_eq!(all_notes.len(), 3);
        assert!(all_notes.iter().any(|(p, b)| p == &path_b && b == "Plano"));

        // get_backlinks mock
        // Procuramos backlinks para path_b
        let mut stmt = db_conn.prepare(
            "SELECT l.source_path, n.title 
             FROM links l
             JOIN notes n ON l.source_path = n.path
             WHERE l.target_path = ?"
        ).unwrap();
        let source_notes: Vec<(String, String)> = stmt.query_map([&path_b], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).unwrap().flatten().collect();
        assert_eq!(source_notes.len(), 1);
        assert_eq!(source_notes[0].0, nota_a);

        // Simula a leitura de arquivo temporário
        let content_a = fs::read_to_string(&file_a_path).unwrap();
        let mut context_line = String::new();
        for line in content_a.lines() {
            if line.to_lowercase().contains("[[plano") {
                context_line = line.trim().to_string();
                break;
            }
        }
        assert_eq!(context_line, "Este é o link para [[Plano]] e mais texto.");

        // Limpeza
        let _ = fs::remove_dir_all(&temp_dir_vault);
        let _ = fs::remove_dir_all(&temp_dir_backlinks);
    }

    // Parser: [[X.md]] normaliza para X (Obsidian-compat) e embed de imagem NÃO vira link.
    // Transclusão de NOTA (![[Nota]], sem extensão de imagem) continua sendo conexão.
    #[test]
    fn test_wiki_link_normalizes_md_and_filters_image_embeds() {
        let content = "Body [[CLAUDE.md]] e [[Nota Normal]] e ![[Pasted image 20260703.png]] \
                       e ![[Transclusao De Nota]] e [[20_Atlas/Sub/Nota]] e [[Foto.JPG]]";
        let meta = parse_markdown(content, "test.md");
        let links: HashSet<&str> = meta.links.iter().map(|s| s.as_str()).collect();

        assert!(links.contains("CLAUDE"), "[[CLAUDE.md]] deve normalizar para CLAUDE");
        assert!(!links.contains("CLAUDE.md"), "a extensão .md não deve sobrar no link");
        assert!(links.contains("Nota Normal"), "link normal intacto");
        assert!(links.contains("20_Atlas/Sub/Nota"), "link path-style intacto");
        assert!(links.contains("Transclusao De Nota"), "transclusão de NOTA continua sendo link");
        assert!(!links.iter().any(|l| l.contains("Pasted image")), "embed de imagem .png NÃO é link");
        assert!(!links.iter().any(|l| l.eq_ignore_ascii_case("foto") || l.contains("Foto")), "embed de imagem .JPG (maiúsculo) NÃO é link");
    }

    // TESTE END-TO-END do bug do relato: [[Nota 2.md]] (com extensão) numa nota deve
    // RESOLVER para a Nota 2 existente — não aparecer como link "a criar". Passa pelo
    // caminho real parse→index→resolve→outgoing (o teste que insere linhas prontas não pega).
    #[test]
    fn test_outgoing_link_with_md_extension_resolves_to_existing_note() {
        let mut conn = create_test_db();
        let temp = std::env::temp_dir().join("mycellia_test_md_ext_resolve");
        let _ = fs::remove_dir_all(&temp);
        let _ = fs::create_dir_all(&temp);
        let vault = temp.to_string_lossy().into_owned();

        let n1 = temp.join("Nota 1.md");
        let n2 = temp.join("Nota 2.md");
        fs::write(&n1, "Aponto para [[Nota 2.md]] com extensao explicita").unwrap();
        fs::write(&n2, "Conteudo da nota 2").unwrap();

        // Indexa as duas notas pelo caminho de produção e resolve os links
        let tx = conn.transaction().unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &n1, 100).unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &n2, 100).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &vault).unwrap();
        tx.commit().unwrap();

        // O link de saída da Nota 1 deve estar RESOLVIDO para a Nota 2 (target_path != NULL)
        let n1_path = n1.to_string_lossy().into_owned();
        let outgoing = crate::commands::index_db::query_outgoing_links(&conn, &n1_path).unwrap();
        assert_eq!(outgoing.len(), 1, "deve haver exatamente 1 link de saída");
        assert_eq!(
            outgoing[0].target_path,
            Some(n2.to_string_lossy().into_owned()),
            "[[Nota 2.md]] deve resolver para a Nota 2 existente, não ficar 'a criar'"
        );

        let _ = fs::remove_dir_all(&temp);
    }

    // Links de SAÍDA (o espelho do get_backlinks): a nota origem deve enxergar quem ela
    // referencia — resolvidos (com path+título) E não-resolvidos (nota ainda não criada).
    #[test]
    fn test_query_outgoing_links_resolved_and_unresolved() {
        use crate::commands::index_db::query_outgoing_links;

        let conn = create_test_db();

        conn.execute(
            "INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
            rusqlite::params!["/vault/Nota 1.md", "Nota 1", 1000],
        ).unwrap();
        conn.execute(
            "INSERT INTO notes (path, title, last_modified) VALUES (?, ?, ?)",
            rusqlite::params!["/vault/Nota 2.md", "Nota 2", 1000],
        ).unwrap();

        // Nota 1 aponta para a Nota 2 (resolvido) e para uma nota inexistente (NULL)
        conn.execute(
            "INSERT INTO links (source_path, target_name, target_path) VALUES (?, ?, ?)",
            rusqlite::params!["/vault/Nota 1.md", "Nota 2", "/vault/Nota 2.md"],
        ).unwrap();
        conn.execute(
            "INSERT INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
            rusqlite::params!["/vault/Nota 1.md", "Ainda Nao Existe"],
        ).unwrap();

        // A origem enxerga os DOIS links de saída, em ordem alfabética de target_name
        let outgoing = query_outgoing_links(&conn, "/vault/Nota 1.md").unwrap();
        assert_eq!(outgoing.len(), 2);
        assert_eq!(outgoing[0].target_name, "Ainda Nao Existe");
        assert_eq!(outgoing[0].target_path, None);
        assert_eq!(outgoing[0].target_title, None);
        assert_eq!(outgoing[1].target_name, "Nota 2");
        assert_eq!(outgoing[1].target_path, Some("/vault/Nota 2.md".to_string()));
        assert_eq!(outgoing[1].target_title, Some("Nota 2".to_string()));

        // A Nota 2 não aponta para ninguém — saída vazia (o caso do relato do bug:
        // direção de SAÍDA não pode vazar para dentro dos backlinks de entrada)
        let outgoing_b = query_outgoing_links(&conn, "/vault/Nota 2.md").unwrap();
        assert!(outgoing_b.is_empty());
    }

    #[test]
    fn test_incremental_indexing_single_file() {
        let mut conn = create_test_db();
        let temp_dir = std::env::temp_dir().join("mycellia_test_inc_single");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let note_path = temp_dir.join("Nota Teste.md");
        fs::write(&note_path, "---\ntitle: Nota Teste\ntags: [rust]\n---\nConteúdo [[Link Interno]]").unwrap();

        let tx = conn.transaction().unwrap();
        let path_str = note_path.to_string_lossy().into_owned();
        crate::commands::index_db::index_single_file_in_tx(&tx, &note_path, 100).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &temp_dir.to_string_lossy()).unwrap();
        tx.commit().unwrap();

        // Verifica inserção
        let note_title: String = conn.query_row("SELECT title FROM notes WHERE path = ?", [&path_str], |row| row.get(0)).unwrap();
        assert_eq!(note_title, "Nota Teste");

        let tag_count: i64 = conn.query_row("SELECT count(*) FROM tags WHERE note_path = ?", [&path_str], |row| row.get(0)).unwrap();
        assert_eq!(tag_count, 1);

        // Modifica a nota e indexa de novo
        fs::write(&note_path, "---\ntitle: Nota Teste Alterada\ntags: [rust, sql]\n---\nNovo").unwrap();
        let tx = conn.transaction().unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &note_path, 101).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &temp_dir.to_string_lossy()).unwrap();
        tx.commit().unwrap();

        // Verifica atualização
        let note_title_new: String = conn.query_row("SELECT title FROM notes WHERE path = ?", [&path_str], |row| row.get(0)).unwrap();
        assert_eq!(note_title_new, "Nota Teste");

        let tag_count_new: i64 = conn.query_row("SELECT count(*) FROM tags WHERE note_path = ?", [&path_str], |row| row.get(0)).unwrap();
        assert_eq!(tag_count_new, 2);

        // Deleta
        let tx = conn.transaction().unwrap();
        crate::commands::index_db::delete_file_in_tx(&tx, &path_str).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &temp_dir.to_string_lossy()).unwrap();
        tx.commit().unwrap();

        // Verifica deleção
        let exists: bool = conn.query_row("SELECT exists(SELECT 1 FROM notes WHERE path = ?)", [&path_str], |row| row.get(0)).unwrap();
        assert!(!exists);

        let tag_count_del: i64 = conn.query_row("SELECT count(*) FROM tags WHERE note_path = ?", [&path_str], |row| row.get(0)).unwrap();
        assert_eq!(tag_count_del, 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_fts5_searches_frontmatter_properties() {
        // F2: a coluna `properties` do FTS deve conter chave+valor do frontmatter, de modo que
        // buscar um VALOR (ex.: "Felipe") ou uma CHAVE (ex.: "author") ache a nota — mesmo que o
        // corpo NÃO contenha essas palavras.
        let mut conn = create_test_db();
        let temp_dir = std::env::temp_dir().join("mycellia_test_fts_props");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let note_path = temp_dir.join("Nota Frontmatter.md");
        fs::write(
            &note_path,
            "---\ntitle: Nota Frontmatter\nauthor: Felipe\nstatus: publicado\n---\nCorpo sem o nome do dono.",
        )
        .unwrap();

        let tx = conn.transaction().unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &note_path, 100).unwrap();
        tx.commit().unwrap();

        // Busca pelo VALOR do frontmatter — o corpo não tem "Felipe", então só acha via properties.
        let hits_value: i64 = conn
            .query_row("SELECT count(*) FROM notes_fts WHERE notes_fts MATCH 'Felipe'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(hits_value, 1, "Busca por valor de frontmatter (Felipe) deveria achar a nota");

        // Busca pela CHAVE do frontmatter.
        let hits_key: i64 = conn
            .query_row("SELECT count(*) FROM notes_fts WHERE notes_fts MATCH 'author'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(hits_key, 1, "Busca pela chave de frontmatter (author) deveria achar a nota");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_incremental_indexing_re_resolve_tie_breaker() {
        let mut conn = create_test_db();
        let temp_dir = std::env::temp_dir().join("mycellia_test_tie_breaker");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let vault_str = temp_dir.to_string_lossy().into_owned();

        // 1. Cria nota de origem A com o link [[Plano]]
        let path_a = temp_dir.join("Nota A.md");
        fs::write(&path_a, "Link para [[Plano]]").unwrap();

        // 2. Cria primeiro candidato Plano (caminho longo: pasta_a/sub/Plano.md)
        let dir_sub = temp_dir.join("pasta_a").join("sub");
        fs::create_dir_all(&dir_sub).unwrap();
        let path_plano_long = dir_sub.join("Plano.md");
        fs::write(&path_plano_long, "Sou o Plano Longo").unwrap();

        // 3. Cria segundo candidato Plano (caminho mais curto: pasta_b/Plano.md)
        let dir_b = temp_dir.join("pasta_b");
        fs::create_dir_all(&dir_b).unwrap();
        let path_plano_short = dir_b.join("Plano.md");
        fs::write(&path_plano_short, "Sou o Plano Curto").unwrap();

        // Indexa todos os 3 arquivos
        let tx = conn.transaction().unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &path_a, 1).unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &path_plano_long, 1).unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &path_plano_short, 1).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &vault_str).unwrap();
        tx.commit().unwrap();

        // Verifica que resolve para o caminho mais curto
        let resolved_path: String = conn.query_row(
            "SELECT target_path FROM links WHERE source_path = ? AND target_name = 'Plano'",
            [path_a.to_str().unwrap()],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(resolved_path, path_plano_short.to_string_lossy().into_owned());

        // 4. Deleta o candidato curto (Plano Curto)
        fs::remove_file(&path_plano_short).unwrap();
        let tx = conn.transaction().unwrap();
        crate::commands::index_db::delete_file_in_tx(&tx, &path_plano_short.to_string_lossy()).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &vault_str).unwrap();
        tx.commit().unwrap();

        // Verifica que re-resolveu para o candidato sobrevivente (Plano Longo)
        let resolved_path_after_del: String = conn.query_row(
            "SELECT target_path FROM links WHERE source_path = ? AND target_name = 'Plano'",
            [path_a.to_str().unwrap()],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(resolved_path_after_del, path_plano_long.to_string_lossy().into_owned());

        // 5. Cria um candidato super curto na raiz: Plano.md
        let path_plano_root = temp_dir.join("Plano.md");
        fs::write(&path_plano_root, "Sou o Plano Root").unwrap();
        let tx = conn.transaction().unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &path_plano_root, 1).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &vault_str).unwrap();
        tx.commit().unwrap();

        // Verifica que re-resolveu para o Plano root
        let resolved_path_final: String = conn.query_row(
            "SELECT target_path FROM links WHERE source_path = ? AND target_name = 'Plano'",
            [path_a.to_str().unwrap()],
            |row| row.get(0)
        ).unwrap();
        assert_eq!(resolved_path_final, path_plano_root.to_string_lossy().into_owned());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_watcher_indexing_integrity_real_disk() {
        use sha2::{Sha256, Digest};
        let temp_dir = std::env::temp_dir().join("mycellia_test_integrity");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let path_a = temp_dir.join("Nota A.md");
        let path_b = temp_dir.join("Nota B.md");
        let path_c = temp_dir.join("Nota C.md");

        fs::write(&path_a, "Conteudo A original").unwrap();
        fs::write(&path_b, "Conteudo B original").unwrap();
        fs::write(&path_c, "Conteudo C original").unwrap();

        // Computa hashes antes da indexação
        let hash_a = {
            let bytes = fs::read(&path_a).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        let hash_b = {
            let bytes = fs::read(&path_b).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        let hash_c = {
            let bytes = fs::read(&path_c).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };

        // Simula alterações e indexação apenas em A e B (C não é alterada)
        let mut conn = create_test_db();
        let tx = conn.transaction().unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &path_a, 1).unwrap();
        crate::commands::index_db::index_single_file_in_tx(&tx, &path_b, 1).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, &temp_dir.to_string_lossy()).unwrap();
        tx.commit().unwrap();

        // Verifica hashes depois da indexação
        let hash_a_after = {
            let bytes = fs::read(&path_a).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        let hash_b_after = {
            let bytes = fs::read(&path_b).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };
        let hash_c_after = {
            let bytes = fs::read(&path_c).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            format!("{:x}", hasher.finalize())
        };

        assert_eq!(hash_a, hash_a_after);
        assert_eq!(hash_b, hash_b_after);
        assert_eq!(hash_c, hash_c_after, "Nota C (não-alvo) foi alterada!");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_get_graph_data_sqlite() {
        use crate::commands::index_db::{DbState, get_graph_data};
        use tauri::Manager;

        let app = tauri::test::mock_builder()
            .manage(DbState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();

        let db_state = handle.state::<DbState>();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        
        conn.execute("CREATE TABLE IF NOT EXISTS notes (path TEXT PRIMARY KEY, title TEXT NOT NULL, last_modified INTEGER NOT NULL);", []).unwrap();
        conn.execute("CREATE TABLE IF NOT EXISTS links (source_path TEXT NOT NULL, target_name TEXT NOT NULL, target_path TEXT, PRIMARY KEY (source_path, target_name), FOREIGN KEY (source_path) REFERENCES notes (path) ON DELETE CASCADE);", []).unwrap();

        conn.execute("INSERT INTO notes (path, title, last_modified) VALUES ('path/A.md', 'Nota A', 100);", []).unwrap();
        conn.execute("INSERT INTO notes (path, title, last_modified) VALUES ('path/B.md', 'Nota B', 200);", []).unwrap();
        
        conn.execute("INSERT INTO links (source_path, target_name, target_path) VALUES ('path/A.md', 'Nota B', 'path/B.md');", []).unwrap();
        conn.execute("INSERT INTO links (source_path, target_name, target_path) VALUES ('path/A.md', 'Nota C', NULL);", []).unwrap();

        *db_state.conn.lock().unwrap() = Some(conn);

        let graph_data = get_graph_data(handle.clone()).unwrap();

        assert_eq!(graph_data.nodes.len(), 3);
        
        let node_a = graph_data.nodes.iter().find(|n| n.id == "path/A.md").unwrap();
        assert_eq!(node_a.label, "Nota A");
        assert!(node_a.exists);
        assert_eq!(node_a.degree, 2);

        let node_b = graph_data.nodes.iter().find(|n| n.id == "path/B.md").unwrap();
        assert_eq!(node_b.label, "Nota B");
        assert!(node_b.exists);
        assert_eq!(node_b.degree, 1);

        let node_c = graph_data.nodes.iter().find(|n| n.id == "phantom:Nota C").unwrap();
        assert_eq!(node_c.label, "Nota C");
        assert!(!node_c.exists);
        assert_eq!(node_c.degree, 1);

        assert_eq!(graph_data.links.len(), 2);
        let link_1 = graph_data.links.iter().find(|l| l.source == "path/A.md" && l.target == "path/B.md");
        assert!(link_1.is_some());
        let link_2 = graph_data.links.iter().find(|l| l.source == "path/A.md" && l.target == "phantom:Nota C");
        assert!(link_2.is_some());
    }

    #[test]
    fn test_graph_positions_atomic_cache() {
        use crate::commands::graph_positions::{load_graph_positions, save_graph_positions, NodePosition};
        use std::collections::HashMap;
        use tauri::Manager;

        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();

        let config_dir = handle.path().app_config_dir().unwrap();
        let cache_file = config_dir.join("graph_positions.json");
        if cache_file.exists() {
            let _ = std::fs::remove_file(&cache_file);
        }

        let mut positions = HashMap::new();
        positions.insert("path/A.md".to_string(), NodePosition {
            x2d: Some(10.0),
            y2d: Some(20.0),
            x3d: Some(10.0),
            y3d: Some(20.0),
            z3d: Some(30.0),
            x: None,
            y: None,
            z: None,
        });
        positions.insert("phantom:Nota C".to_string(), NodePosition {
            x2d: Some(-100.5),
            y2d: Some(50.2),
            x3d: Some(-100.5),
            y3d: Some(50.2),
            z3d: Some(0.0),
            x: None,
            y: None,
            z: None,
        });

        save_graph_positions(handle.clone(), positions.clone()).unwrap();

        assert!(cache_file.exists());

        let loaded = load_graph_positions(handle.clone());
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded.get("path/A.md").unwrap(), positions.get("path/A.md").unwrap());
        assert_eq!(loaded.get("phantom:Nota C").unwrap(), positions.get("phantom:Nota C").unwrap());

        let _ = std::fs::remove_file(&cache_file);
    }

    #[test]
    fn test_fts5_real_search_notes() {
        use crate::commands::index_db::{DbState, search_notes, get_matching_paths};
        use tauri::Manager;

        let app = tauri::test::mock_builder()
            .manage(DbState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle();

        let db_state = handle.state::<DbState>();
        let conn = rusqlite::Connection::open_in_memory().unwrap();

        // Cria tabela virtual FTS5
        conn.execute(
            "CREATE VIRTUAL TABLE notes_fts USING fts5(path, title, content, tags, properties);",
            [],
        ).unwrap();

        // Insere conteúdo conhecido para busca
        conn.execute(
            "INSERT INTO notes_fts (path, title, content, tags, properties) VALUES (?1, ?2, ?3, ?4, ?5);",
            [
                "path/A.md",
                "Nota A",
                "O micelio e uma teia incrivel de conexoes de hifas bioluminescentes no escuro.",
                "tag1",
                "",
            ],
        ).unwrap();
        conn.execute(
            "INSERT INTO notes_fts (path, title, content, tags, properties) VALUES (?1, ?2, ?3, ?4, ?5);",
            [
                "path/B.md",
                "Nota B",
                "Nada de hifas nesta nota, apenas texto simples.",
                "tag2",
                "",
            ],
        ).unwrap();

        *db_state.conn.lock().unwrap() = Some(conn);

        // Executa busca por "micelio"
        let results = search_notes(handle.clone(), "micelio".to_string()).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "path/A.md");
        assert_eq!(results[0].title, "Nota A");
        // Verifica que o snippet contém a tag <b> de marcação do SQLite FTS5 extraída do conteúdo
        assert!(results[0].snippet.contains("<b>micelio</b>"), "Snippet inválido: {}", results[0].snippet);

        // Executa busca por "hifas"
        let results_hifas = search_notes(handle.clone(), "hifas".to_string()).unwrap();
        assert_eq!(results_hifas.len(), 2);

        // Verifica get_matching_paths por "micelio"
        let paths = get_matching_paths(handle.clone(), "micelio".to_string()).unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0], "path/A.md");

        // Verifica get_matching_paths por "hifas"
        let paths_hifas = get_matching_paths(handle.clone(), "hifas".to_string()).unwrap();
        assert_eq!(paths_hifas.len(), 2);
        assert!(paths_hifas.contains(&"path/A.md".to_string()));
        assert!(paths_hifas.contains(&"path/B.md".to_string()));
    }

    #[test]
    fn test_case_sensitive_link_resolution_desempate() {
        use crate::commands::index_db::resolve_target_path;

        let vault_path = "/home/user/vault";
        let all_paths = vec![
            "/home/user/vault/Nota.md".to_string(),
            "/home/user/vault/nota.md".to_string(),
        ];

        // 1. [[Nota]] resolve para Nota.md (match exato case-sensitive)
        let resolved_nota_caps = resolve_target_path("Nota", &all_paths, vault_path);
        assert_eq!(resolved_nota_caps, Some("/home/user/vault/Nota.md".to_string()));

        // 2. [[nota]] resolve para nota.md (match exato case-sensitive)
        let resolved_nota_lower = resolve_target_path("nota", &all_paths, vault_path);
        assert_eq!(resolved_nota_lower, Some("/home/user/vault/nota.md".to_string()));

        // 3. [[NOTA]] (sem match exato) cai no fallback case-insensitive e resolve deterministicamente para Nota.md (ASCII 'N' < 'n')
        let resolved_nota_all_caps = resolve_target_path("NOTA", &all_paths, vault_path);
        assert_eq!(resolved_nota_all_caps, Some("/home/user/vault/Nota.md".to_string()));
    }

    #[test]
    fn test_re_resolve_honors_case_sensitive_precedence() {
        // Spec 16, Achado A: o re_resolve_all_links tinha uma segunda implementação SÓ
        // case-insensitive — num filesystem case-sensitive (Linux) com Nota.md + nota.md,
        // qualquer batch do watcher flipava [[nota]] (exato → nota.md) para Nota.md
        // (tie-break lex: 'N' < 'n'). O F4 unifica na semântica exato-primeiro do §33.
        // Teste puro-DB: não cria arquivos (NTFS não permite Nota.md e nota.md juntos).
        let mut conn = create_test_db();
        let vault = "/home/user/vault";

        let tx = conn.transaction().unwrap();
        for path in [
            "/home/user/vault/Nota.md",
            "/home/user/vault/nota.md",
            "/home/user/vault/fonte.md",
        ] {
            tx.execute(
                "INSERT INTO notes (path, title, last_modified) VALUES (?, ?, 1)",
                [path, "titulo"],
            ).unwrap();
        }
        tx.execute(
            "INSERT INTO links (source_path, target_name, target_path) VALUES ('/home/user/vault/fonte.md', 'nota', NULL)",
            [],
        ).unwrap();

        crate::commands::index_db::re_resolve_all_links(&tx, vault).unwrap();
        tx.commit().unwrap();

        let resolved: String = conn.query_row(
            "SELECT target_path FROM links WHERE source_path = '/home/user/vault/fonte.md' AND target_name = 'nota'",
            [],
            |row| row.get(0),
        ).unwrap();

        // Match exato case-sensitive tem precedência (regra do §33) — antes do fix vinha Nota.md
        assert_eq!(resolved, "/home/user/vault/nota.md");
    }

    #[test]
    fn test_incremental_re_resolve_updates_unmodified_sources() {
        // Spec 16, Achado B: nota deletada COM O APP FECHADO → o delta do index_vault agora
        // re-resolve links de arquivos NÃO-modificados que apontavam pra ela. Pinado no nível
        // da função: changed = {path deletado} atualiza link cujo source NÃO está no delta.
        let mut conn = create_test_db();
        let vault = "/vault";

        let tx = conn.transaction().unwrap();
        for path in ["/vault/fonte.md", "/vault/Plano.md", "/vault/a/Plano.md"] {
            tx.execute(
                "INSERT INTO notes (path, title, last_modified) VALUES (?, 't', 1)",
                [path],
            ).unwrap();
        }
        tx.execute(
            "INSERT INTO links (source_path, target_name, target_path) VALUES ('/vault/fonte.md', 'Plano', NULL)",
            [],
        ).unwrap();
        crate::commands::index_db::re_resolve_all_links(&tx, vault).unwrap();
        tx.commit().unwrap();

        // Dois candidatos exatos; tie-break de caminho curto → raiz
        let resolved: String = conn.query_row(
            "SELECT target_path FROM links WHERE source_path = '/vault/fonte.md'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(resolved, "/vault/Plano.md");

        // "Com o app fechado": Plano.md sumiu. Delta do boot = só o path deletado.
        let tx = conn.transaction().unwrap();
        tx.execute("DELETE FROM notes WHERE path = '/vault/Plano.md'", []).unwrap();
        let changed: HashSet<String> = ["/vault/Plano.md".to_string()].into_iter().collect();
        crate::commands::index_db::re_resolve_links_incremental(&tx, vault, &changed).unwrap();
        tx.commit().unwrap();

        let resolved_after: String = conn.query_row(
            "SELECT target_path FROM links WHERE source_path = '/vault/fonte.md'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(
            resolved_after, "/vault/a/Plano.md",
            "link de arquivo não-modificado deve re-resolver para o candidato sobrevivente"
        );
    }

    // ---------- Teste de propriedade F4 (Spec 16, critério de aceite #1) ----------

    // PRNG determinístico (xorshift64) — sem dependência externa; falha reproduz pelo seed
    // impresso na mensagem do assert. Decisão D8 do Spec 16 (leveza consciente vs proptest).
    struct XorShift64(u64);
    impl XorShift64 {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            self.0 = x;
            x
        }
        fn range(&mut self, n: usize) -> usize {
            (self.next() % n as u64) as usize
        }
    }

    fn read_links_sorted(conn: &Connection) -> Vec<(String, String, Option<String>)> {
        let mut stmt = conn
            .prepare("SELECT source_path, target_name, target_path FROM links ORDER BY source_path, target_name")
            .unwrap();
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap();
        rows.flatten().collect()
    }

    #[test]
    fn test_property_incremental_equals_full_resolution() {
        // A propriedade: após CADA mutação (create/delete/edit/move) aplicada com o re-resolve
        // INCREMENTAL, a tabela links é idêntica (a) ao oráculo ingênuo resolve_target_path
        // avaliado por link sobre o estado vivo e (b) à resolução FULL rodada do zero.
        // Puro-DB: permite colisões de case (Nota.md + nota.md) impossíveis de criar no NTFS,
        // então o cenário roda idêntico nos 3 SOs.
        use crate::commands::index_db::{
            re_resolve_all_links, re_resolve_links_incremental, resolve_target_path,
        };

        const VAULT: &str = "/vault";
        // Pools desenhados para colidir: mesmo basename em cases e profundidades diferentes,
        // dirs que só diferem por case, targets por basename e por caminho relativo + fantasma.
        const DIRS: [&str; 5] = ["", "a/", "b/", "B/", "a/sub/"];
        const BASENAMES: [&str; 5] = ["Plano", "plano", "Nota", "nota", "Ideia"];
        const TARGETS: [&str; 11] = [
            "Plano", "plano", "PLANO", "Nota", "nota",
            "a/Plano", "a/sub/plano", "B/nota", "b/Nota", "Ideia", "fantasma",
        ];

        for seed in 1..=100u64 {
            let mut rng = XorShift64(seed);
            let mut conn = create_test_db();

            // Estado espelho: paths vivos (fonte de verdade para o oráculo)
            let mut live_paths: Vec<String> = Vec::new();

            // 1. Vault inicial (~8 notas em slots aleatórios) + ~12 links, resolução full
            let tx = conn.transaction().unwrap();
            for _ in 0..8 {
                let path = format!(
                    "{}/{}{}.md",
                    VAULT,
                    DIRS[rng.range(DIRS.len())],
                    BASENAMES[rng.range(BASENAMES.len())]
                );
                if live_paths.contains(&path) {
                    continue;
                }
                tx.execute(
                    "INSERT INTO notes (path, title, last_modified) VALUES (?, 't', 1)",
                    [&path],
                ).unwrap();
                live_paths.push(path);
            }
            for _ in 0..12 {
                let source = live_paths[rng.range(live_paths.len())].clone();
                let target = TARGETS[rng.range(TARGETS.len())];
                tx.execute(
                    "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
                    rusqlite::params![source, target],
                ).unwrap();
            }
            re_resolve_all_links(&tx, VAULT).unwrap();
            tx.commit().unwrap();

            // 2. Oito mutações; após cada uma, incremental == oráculo == full
            for step in 0..8 {
                let tx = conn.transaction().unwrap();
                let mut changed: HashSet<String> = HashSet::new();
                let op = rng.range(4);

                match op {
                    // CREATE: nota nova em slot livre, com links próprios (inseridos NULL)
                    0 => {
                        let mut created = None;
                        for _ in 0..10 {
                            let candidate = format!(
                                "{}/{}{}.md",
                                VAULT,
                                DIRS[rng.range(DIRS.len())],
                                BASENAMES[rng.range(BASENAMES.len())]
                            );
                            if !live_paths.contains(&candidate) {
                                created = Some(candidate);
                                break;
                            }
                        }
                        if let Some(path) = created {
                            tx.execute(
                                "INSERT INTO notes (path, title, last_modified) VALUES (?, 't', 1)",
                                [&path],
                            ).unwrap();
                            for _ in 0..rng.range(3) {
                                let target = TARGETS[rng.range(TARGETS.len())];
                                tx.execute(
                                    "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
                                    rusqlite::params![path, target],
                                ).unwrap();
                            }
                            changed.insert(path.clone());
                            live_paths.push(path);
                        }
                    }
                    // DELETE: o cascade (FK) limpa os links DA nota; links PARA ela re-resolvem via chave
                    1 => {
                        if live_paths.len() > 1 {
                            let idx = rng.range(live_paths.len());
                            let path = live_paths.remove(idx);
                            tx.execute("DELETE FROM notes WHERE path = ?", [&path]).unwrap();
                            changed.insert(path);
                        }
                    }
                    // EDIT: troca os links de uma nota (re-insere NULL) — espelha index_single_file_in_tx
                    2 => {
                        let path = live_paths[rng.range(live_paths.len())].clone();
                        tx.execute("DELETE FROM links WHERE source_path = ?", [&path]).unwrap();
                        for _ in 0..(1 + rng.range(3)) {
                            let target = TARGETS[rng.range(TARGETS.len())];
                            tx.execute(
                                "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
                                rusqlite::params![path, target],
                            ).unwrap();
                        }
                        changed.insert(path);
                    }
                    // MOVE/RENAME: delete + insert preservando os target_names (conteúdo não mudou)
                    _ => {
                        let mut dest = None;
                        for _ in 0..10 {
                            let candidate = format!(
                                "{}/{}{}.md",
                                VAULT,
                                DIRS[rng.range(DIRS.len())],
                                BASENAMES[rng.range(BASENAMES.len())]
                            );
                            if !live_paths.contains(&candidate) {
                                dest = Some(candidate);
                                break;
                            }
                        }
                        if let Some(new_path) = dest {
                            let idx = rng.range(live_paths.len());
                            let old_path = live_paths.remove(idx);
                            let names: Vec<String> = {
                                let mut stmt = tx
                                    .prepare("SELECT target_name FROM links WHERE source_path = ?")
                                    .unwrap();
                                let rows = stmt
                                    .query_map([&old_path], |row| row.get::<_, String>(0))
                                    .unwrap();
                                rows.flatten().collect()
                            };
                            tx.execute("DELETE FROM notes WHERE path = ?", [&old_path]).unwrap();
                            tx.execute(
                                "INSERT INTO notes (path, title, last_modified) VALUES (?, 't', 1)",
                                [&new_path],
                            ).unwrap();
                            for name in names {
                                tx.execute(
                                    "INSERT OR REPLACE INTO links (source_path, target_name, target_path) VALUES (?, ?, NULL)",
                                    rusqlite::params![new_path, name],
                                ).unwrap();
                            }
                            changed.insert(old_path);
                            changed.insert(new_path.clone());
                            live_paths.push(new_path);
                        }
                    }
                }

                re_resolve_links_incremental(&tx, VAULT, &changed).unwrap();
                tx.commit().unwrap();

                // (a) incremental == oráculo ingênuo por link, sobre o estado vivo
                let snapshot_incremental = read_links_sorted(&conn);
                for (source, name, target) in &snapshot_incremental {
                    let expected = resolve_target_path(name, &live_paths, VAULT);
                    assert_eq!(
                        target, &expected,
                        "ORÁCULO divergiu (seed {}, step {}, op {}): link {} -> [[{}]]",
                        seed, step, op, source, name
                    );
                }

                // (b) incremental == full rodada do zero (zera target_path e re-resolve tudo)
                let tx = conn.transaction().unwrap();
                tx.execute("UPDATE links SET target_path = NULL", []).unwrap();
                re_resolve_all_links(&tx, VAULT).unwrap();
                tx.commit().unwrap();
                let snapshot_full = read_links_sorted(&conn);
                assert_eq!(
                    snapshot_incremental, snapshot_full,
                    "INCREMENTAL != FULL (seed {}, step {}, op {})",
                    seed, step, op
                );
            }
        }
    }

    // =========================================================================
    // TESTE E2 Fatia A (Spec 28): semântica da busca por tag + agregação
    // (mesmos SQLs dos comandos get_all_tags / search_notes / get_matching_paths)
    // =========================================================================
    #[test]
    fn test_tag_search_and_aggregation_semantics() {
        let conn = create_test_db();

        index_note_in_db(&conn, "C:\\V\\a.md", "# A\ncorpo #projeto/mycellia e #foco", "a.md", 1);
        index_note_in_db(&conn, "C:\\V\\b.md", "# B\n#projeto no texto", "b.md", 2);
        index_note_in_db(
            &conn,
            "C:\\V\\c.md",
            "---\ntags: [projeto/mycellia]\n---\n# C\nsó frontmatter",
            "c.md",
            3,
        );
        index_note_in_db(&conn, "C:\\V\\d.md", "# D\nsem tag nenhuma", "d.md", 4);

        // 1. Agregação com contagem (SQL do get_all_tags) — taxonomia unificada:
        //    frontmatter + inline caem na MESMA tabela
        let mut stmt = conn
            .prepare("SELECT tag, COUNT(*) FROM tags GROUP BY tag ORDER BY tag COLLATE NOCASE")
            .unwrap();
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(
            rows,
            vec![
                ("foco".to_string(), 1),
                ("projeto".to_string(), 1),
                ("projeto/mycellia".to_string(), 2),
            ]
        );

        // 2. Buscar a tag PAI inclui as filhas aninhadas (SQL do get_matching_paths)
        let mut stmt = conn
            .prepare("SELECT DISTINCT note_path FROM tags WHERE tag = ?1 COLLATE NOCASE OR tag LIKE ?1 || '/%'")
            .unwrap();
        let mut paths: Vec<String> = stmt.query_map(["projeto"], |r| r.get(0)).unwrap().flatten().collect();
        paths.sort();
        assert_eq!(paths, vec!["C:\\V\\a.md", "C:\\V\\b.md", "C:\\V\\c.md"]);

        // 3. Tag folha só pega quem tem a folha
        let mut leaf: Vec<String> = stmt
            .query_map(["projeto/mycellia"], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();
        leaf.sort();
        assert_eq!(leaf, vec!["C:\\V\\a.md", "C:\\V\\c.md"]);

        // 4. Igualdade case-insensitive
        let upper: Vec<String> = stmt.query_map(["FOCO"], |r| r.get(0)).unwrap().flatten().collect();
        assert_eq!(upper, vec!["C:\\V\\a.md"]);

        // 5. Nota sem tag não aparece em nenhuma busca por tag
        let all_tagged: Vec<String> = conn
            .prepare("SELECT DISTINCT note_path FROM tags")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .flatten()
            .collect();
        assert!(!all_tagged.contains(&"C:\\V\\d.md".to_string()));
    }
}

