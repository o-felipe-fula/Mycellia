# 🍄 Mycellia

> Seu segundo cérebro, **local-first** e construído para a era dos agentes.

[![CI](https://github.com/o-felipe-fula/Mycellia/actions/workflows/checks.yml/badge.svg)](https://github.com/o-felipe-fula/Mycellia/actions)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

O Mycellia é um editor de conhecimento em Markdown: suas notas são **arquivos `.md` puros no seu disco**, indexados por um backend em Rust com SQLite, visualizados num grafo vivo e editados num preview instantâneo. Compatível com vaults do Obsidian — abra o seu e continue de onde parou.

**Zero lock-in. Zero nuvem obrigatória. Seus arquivos são seus.**

---

## Princípios

1. **`.md` é sagrado** — o app nunca corrompe, reescreve ou perde uma nota. Escrita atômica (`tmp → sync → rename`), teste de regressão byte a byte em tudo que toca disco.
2. **Local-first de verdade** — funciona 100% offline. O índice é derivado e descartável; a verdade são seus arquivos.
3. **Compatível com Obsidian** — wiki-links, callouts, tags, frontmatter, embeds e block refs seguem a mesma sintaxe. Vai e volta sem dor.
4. **AI-native por design** *(em construção)* — o roadmap leva a um grafo navegável por agentes com MCP nativo: seu segundo cérebro que trabalha junto, não só armazena.

## O que já funciona hoje

### ✍️ Editor
- **Live preview** estilo Obsidian: a linha ativa mostra a fonte, o resto renderiza
- **Callouts** (`> [!tip]`, 13 tipos + aliases, aninhamento, fold)
- **Mermaid** — 21 tipos de diagrama (flowchart, sequence, gantt, mindmap, timeline…)
- **HTML inline** seguro (`<u>`, `<mark>`, `<sub>`…) e tabelas renderizadas
- **Slash menu** (`/`) para inserir blocos sem decorar sintaxe + **toolbar flutuante** de seleção
- **Modo Fonte** (`Ctrl+E`) — o arquivo cru, como um editor de código
- Largura de linha configurável (confortável ↔ tela cheia), temas claro/escuro

### 🔗 Conexões
- Wiki-links `[[Nota]]`, para seções `[[Nota#Título]]` e blocos `[[Nota#^id]]` — com autocomplete de notas, títulos e âncoras
- **Transclusão**: `![[Nota]]` embeda a nota inteira; `![[Nota#Seção]]` só a seção
- **Painel bidirecional**: quem aponta para a nota E para onde ela aponta
- **Grafo 2D/3D** do vault inteiro — a busca acende as notas correspondentes

### 🏷️ Organização
- **Tags aninhadas** (`#projeto/subprojeto`) unificadas: frontmatter + inline na mesma taxonomia
- Painel de tags em árvore com contagens; clique busca — e o grafo acende
- **Busca full-text** (SQLite FTS5) sobre conteúdo, títulos, tags e propriedades
- Frontmatter YAML nativo com painel de propriedades

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime desktop | [Tauri 2](https://tauri.app/) (Rust) |
| Indexação | Rust + SQLite (FTS5), watcher de arquivos |
| Interface | React 18 + [CodeMirror 6](https://codemirror.net/) + Tailwind 4 |
| Grafo | react-force-graph (2D/3D, WebGL) |

## Rodando localmente

Pré-requisitos: [Node 20+](https://nodejs.org) e [Rust estável](https://rustup.rs) (+ [pré-requisitos do Tauri](https://tauri.app/start/prerequisites/) do seu SO).

```bash
git clone https://github.com/o-felipe-fula/Mycellia.git
cd Mycellia
npm install
npm run tauri dev
```

Testes e qualidade:

```bash
npm run test          # suíte do front (Vitest)
cd src-tauri && cargo test   # suíte do backend
npm run lint          # ESLint (zero warnings)
npm run build         # TypeScript estrito + bundle
```

## Estado do projeto

**Pré-1.0, em desenvolvimento ativo e aberto.** A fundação (integridade de dados, fail-soft, indexação incremental) e o editor (paridade de leitura/escrita com Obsidian) estão sólidos e cobertos por ~250 testes rodando em Linux, macOS e Windows a cada PR.

No horizonte, nesta ordem: auto-update, snapshots/histórico local, templates, onboarding — e então a camada de agentes (MCP nativo). Até a 1.0: faça backup do seu vault (você já faz, né?).

## Licença

[AGPL-3.0](LICENSE) — o núcleo é livre e vai continuar livre.

---

*Mycellia: como as redes de micélio sob a floresta — invisíveis, vivas, conectando tudo.* 🍄
