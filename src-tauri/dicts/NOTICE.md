# Dicionários Hunspell embarcados (E3 — corretor ortográfico)

Arquivos de DADOS de terceiros distribuídos junto com o Mycellia (app AGPL-3.0).
Fonte: repositório de dicionários do LibreOffice
(https://github.com/LibreOffice/dictionaries), baixados em 2026-07-30.

| Arquivos | Dicionário | Autoria / Licença |
|----------|------------|-------------------|
| `pt_BR.aff` / `pt_BR.dic` | VERO — Verificador Ortográfico do LibreOffice (pt-BR) | © Raimundo Santos Moura e colaboradores — **LGPLv3 / MPL** (dual) |
| `en_US.aff` / `en_US.dic` | en_US (base SCOWL de Kevin Atkinson + curadoria Marco A.G. Pinto) | Licenças permissivas listadas no cabeçalho do `.aff` e em README_en_US.txt do repositório-fonte — **MIT/BSD-like** |

Os dicionários são dados independentes carregados pelo motor `spellbook` (crate Rust,
licença MPL-2.0 — port do Nuspell). Nenhum código dos projetos acima é linkado.
