use pulldown_cmark::{Parser, Event, Tag, TagEnd};
use yaml_rust2::{YamlLoader, Yaml};
use serde::{Serialize, Deserialize};
use std::collections::HashSet;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ParsedNoteMetadata {
    pub title: String,
    pub properties: Vec<(String, String)>, // (key, json_string_value)
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub clean_text: String,
}

// Converte um nó Yaml em serde_json::Value
fn yaml_to_json(yaml: &Yaml) -> serde_json::Value {
    match yaml {
        Yaml::Null => serde_json::Value::Null,
        Yaml::Boolean(b) => serde_json::Value::Bool(*b),
        Yaml::Integer(i) => serde_json::Value::Number((*i).into()),
        Yaml::Real(s) => {
            if let Ok(f) = s.parse::<f64>() {
                if let Some(num) = serde_json::Number::from_f64(f) {
                    return serde_json::Value::Number(num);
                }
            }
            serde_json::Value::String(s.clone())
        }
        Yaml::String(s) => serde_json::Value::String(s.clone()),
        Yaml::Array(arr) => {
            let json_arr: Vec<serde_json::Value> = arr.iter().map(yaml_to_json).collect();
            serde_json::Value::Array(json_arr)
        }
        Yaml::Hash(hash) => {
            let mut map = serde_json::Map::new();
            for (k, v) in hash {
                let k_str = match k {
                    Yaml::String(s) => s.clone(),
                    Yaml::Integer(i) => i.to_string(),
                    Yaml::Boolean(b) => b.to_string(),
                    _ => "key".to_string(),
                };
                map.insert(k_str, yaml_to_json(v));
            }
            serde_json::Value::Object(map)
        }
        _ => serde_json::Value::Null,
    }
}

// Extrai tags do nó Yaml e insere no HashSet
fn extract_tags_from_yaml(yaml: &Yaml, tags_set: &mut HashSet<String>) {
    match yaml {
        Yaml::String(s) => {
            for tag in s.split(',') {
                let trimmed = tag.trim().trim_start_matches('#');
                if !trimmed.is_empty() {
                    tags_set.insert(trimmed.to_string());
                }
            }
        }
        Yaml::Array(arr) => {
            for item in arr {
                if let Yaml::String(s) = item {
                    let trimmed = s.trim().trim_start_matches('#');
                    if !trimmed.is_empty() {
                        tags_set.insert(trimmed.to_string());
                    }
                }
            }
        }
        _ => {}
    }
}

// Verifica se uma string parece ser uma cor hexadecimal (ex: ff0000, aabbcc, fff)
// Extrai tags inline do texto bruto (markdown_body), pulando regiões de código
fn extract_tags_from_raw(body: &str, exclude_ranges: &[(usize, usize)], tags_set: &mut HashSet<String>) {
    let bytes = body.as_bytes();
    let is_in_exclude = |byte_pos: usize| -> bool {
        exclude_ranges.iter().any(|(s, e)| byte_pos >= *s && byte_pos < *e)
    };

    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            let is_boundary = i == 0 || bytes[i - 1].is_ascii_whitespace();
            if is_boundary && !is_in_exclude(i)
                && i + 1 < bytes.len() {
                    let first_char = bytes[i + 1];
                    let is_start_char = first_char.is_ascii_alphabetic() || first_char == b'_';
                    if is_start_char {
                        let mut tag_len = 1;
                        while i + 1 + tag_len < bytes.len() {
                            let next_char = bytes[i + 1 + tag_len];
                            let is_tag_char = next_char.is_ascii_alphanumeric() 
                                || next_char == b'_' 
                                || next_char == b'-' 
                                || next_char == b'/';
                            if is_tag_char {
                                tag_len += 1;
                            } else {
                                break;
                            }
                        }
                        
                        if let Ok(tag_name) = std::str::from_utf8(&bytes[i + 1..i + 1 + tag_len]) {
                            tags_set.insert(tag_name.to_string());
                        }
                        i += 1 + tag_len;
                        continue;
                    }
                }
        }
        i += 1;
    }
}

// Extrai wiki-links [[Link]] e [[Link|Alias]] diretamente do texto bruto,
// pulando regiões de código delimitadas por ``` (fenced code blocks)
fn extract_wiki_links_from_raw(body: &str, links_set: &mut HashSet<String>) {
    // Primeiro: identifica regiões de code blocks (fenced com ```)
    let mut code_regions: Vec<(usize, usize)> = Vec::new();
    let mut in_code = false;
    let mut code_start = 0usize;
    let mut pos = 0;
    for line in body.lines() {
        let line_start = pos;
        let line_end = pos + line.len();

        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if in_code {
                // Fechando bloco de código
                code_regions.push((code_start, line_end));
                in_code = false;
            } else {
                // Abrindo bloco de código
                code_start = line_start;
                in_code = true;
            }
        }

        // +1 para o \n (ou fim de string)
        pos = line_end + 1; // pode ultrapassar body.len() na última linha, OK
    }
    // Se ficou aberto, fecha até o fim
    if in_code {
        code_regions.push((code_start, body.len()));
    }

    // Também identifica regiões de código inline (`...`) para excluir
    // Somente single-backtick inline code — fenced blocks (```) já estão em code_regions
    let mut inline_code_regions: Vec<(usize, usize)> = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let backtick_start = i;
            let mut backtick_count = 0;
            while i < bytes.len() && bytes[i] == b'`' {
                backtick_count += 1;
                i += 1;
            }
            // Somente inline code (1-2 backticks). 3+ é fenced code block.
            if backtick_count <= 2 {
                // Verifica que não estamos dentro de um fenced code block
                let in_fenced = code_regions.iter().any(|(s, e)| backtick_start >= *s && backtick_start < *e);
                if !in_fenced {
                    let closing_pattern: String = std::iter::repeat_n('`', backtick_count).collect();
                    if let Some(close_offset) = body[i..].find(&closing_pattern) {
                        let close_end = i + close_offset + backtick_count;
                        inline_code_regions.push((backtick_start, close_end));
                        i = close_end;
                        continue;
                    }
                }
            }
            continue;
        }
        i += 1;
    }

    // Helper: verifica se uma posição está dentro de uma região de código
    let is_in_code = |pos: usize| -> bool {
        code_regions.iter().any(|(s, e)| pos >= *s && pos < *e)
            || inline_code_regions.iter().any(|(s, e)| pos >= *s && pos < *e)
    };

    // Agora extrai wiki-links do texto bruto, pulando regiões de código
    let mut search_idx = 0;
    while let Some(open_pos) = body[search_idx..].find("[[") {
        let abs_open = search_idx + open_pos;

        // Pula se estiver em região de código
        if is_in_code(abs_open) {
            search_idx = abs_open + 2;
            continue;
        }

        if let Some(close_pos) = body[abs_open + 2..].find("]]") {
            let abs_close = abs_open + 2 + close_pos;
            let link_content = &body[abs_open + 2..abs_close];

            // Ignora links que contêm quebra de linha (malformados)
            if !link_content.contains('\n') {
                let target = match link_content.find('|') {
                    Some(pipe_pos) => &link_content[..pipe_pos],
                    None => link_content,
                };
                let target_trimmed = target.trim();
                if !target_trimmed.is_empty() {
                    links_set.insert(target_trimmed.to_string());
                }
            }
            search_idx = abs_close + 2;
        } else {
            break;
        }
    }
}

pub fn parse_markdown(content: &str, file_name: &str) -> ParsedNoteMetadata {
    let mut properties = Vec::new();
    let mut tags_set = HashSet::new();
    let mut links_set = HashSet::new();
    let mut clean_text = String::new();

    let mut markdown_body = content;

    // 1. Extração e parsing do Frontmatter YAML
    if content.starts_with("---") {
        let lines: Vec<&str> = content.lines().collect();
        if !lines.is_empty() && lines[0].trim() == "---" {
            let mut end_idx = None;
            for (idx, line) in lines.iter().enumerate().skip(1) {
                if line.trim() == "---" {
                    end_idx = Some(idx);
                    break;
                }
            }

            if let Some(idx) = end_idx {
                let yaml_lines = &lines[1..idx];
                let yaml_str = yaml_lines.join("\n");
                
                // Calcula onde começa o corpo do markdown
                let mut char_count = 0;
                for line in lines.iter().take(idx + 1) {
                    char_count += line.len() + 1; // +1 para a quebra de linha
                }
                if char_count < content.len() {
                    markdown_body = &content[char_count..];
                } else {
                    markdown_body = "";
                }

                if let Ok(docs) = YamlLoader::load_from_str(&yaml_str) {
                    if let Some(Yaml::Hash(hash)) = docs.first() {
                        for (key_node, val_node) in hash {
                            if let Some(key_str) = key_node.as_str() {
                                let json_val = yaml_to_json(val_node);
                                let json_str = serde_json::to_string(&json_val).unwrap_or_else(|_| "null".to_string());
                                properties.push((key_str.to_string(), json_str));

                                if key_str == "tags" || key_str == "tag" {
                                    extract_tags_from_yaml(val_node, &mut tags_set);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Extrai wiki-links diretamente do texto bruto do markdown (não via pulldown-cmark,
    //    que interpreta [[...]] como possíveis links markdown e distorce a sintaxe wiki-link)
    extract_wiki_links_from_raw(markdown_body, &mut links_set);

    // 3. Coleta de regiões a serem excluídas para a extração de tags inline
    let mut exclude_ranges = Vec::new();
    let mut code_block_start = None;

    let parser_for_offsets = Parser::new(markdown_body);
    for (event, range) in parser_for_offsets.into_offset_iter() {
        match event {
            Event::Start(Tag::CodeBlock(_)) => {
                code_block_start = Some(range.start);
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some(start) = code_block_start.take() {
                    exclude_ranges.push((start, range.end));
                }
            }
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => {
                exclude_ranges.push((range.start, range.end));
            }
            _ => {}
        }
    }
    if let Some(start) = code_block_start {
        exclude_ranges.push((start, markdown_body.len()));
    }

    // Extrai tags inline do texto bruto, respeitando as regiões excluídas
    extract_tags_from_raw(markdown_body, &exclude_ranges, &mut tags_set);

    // 4. Criação do texto limpo para o FTS5 (pulando blocos de código)
    let parser = Parser::new(markdown_body);
    let mut in_code_block = false;

    for event in parser {
        match event {
            Event::Start(Tag::CodeBlock(_)) => {
                in_code_block = true;
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
            }
            Event::Code(_) => {
                // Código inline também é ignorado para o FTS5 clean text
            }
            Event::Text(text)
                if !in_code_block => {
                    clean_text.push_str(&text);
                    clean_text.push(' ');
                }
            _ => {}
        }
    }

    let title = file_name.replace(".md", "");

    ParsedNoteMetadata {
        title,
        properties,
        tags: tags_set.into_iter().collect(),
        links: links_set.into_iter().collect(),
        clean_text: clean_text.trim().to_string(),
    }
}
