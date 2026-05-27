# Instruções de Build — Mycellia

Este documento orienta sobre como compilar e empacotar a aplicação Mycellia localmente (Windows/macOS) e através da esteira de CI/CD (GitHub Actions).

---

## 1. Build Local

Para rodar o build local, certifique-se de que os pré-requisitos do Tauri v2 (Rust, Node.js) estão instalados em sua máquina.

### Windows (Instalador `.exe` via NSIS)
1. Certifique-se de ter o compilador do Visual Studio e o **NSIS** instalado em seu sistema.
2. Na raiz do projeto, instale as dependências:
   ```bash
   npm ci
   ```
3. Execute o comando de build:
   ```bash
   npm run tauri build
   ```
   *(ou `npx tauri build`)*
4. O instalador gerado estará localizado em:
   `src-tauri/target/release/bundle/nsis/Mycellia_0.5.0_x64-setup.exe`

### macOS (Pacotes `.dmg` e `.app`)
1. Instale as dependências:
   ```bash
   npm ci
   ```
2. Execute o comando de build:
   ```bash
   npm run tauri build
   ```
3. Os arquivos compilados serão gerados sob:
   - **Aplicativo `.app`**: `src-tauri/target/release/bundle/macos/Mycellia.app`
   - **Imagem `.dmg`**: `src-tauri/target/release/bundle/dmg/Mycellia_0.5.0_x64.dmg` (ou `aarch64.dmg` para Macs M1/M2/M3)

---

## 2. Build via CI/CD (GitHub Actions)

Como não temos acesso a hardware Mac localmente, o pipeline do GitHub Actions compila os pacotes e instaladores automaticamente. Os builds não utilizam assinaturas digitais ou certificados (code signing).

### Como disparar o build
O workflow do GitHub Actions (`.github/workflows/build.yml`) pode ser disparado de duas formas:
1. **Manual (workflow_dispatch)**: Na aba **Actions** do repositório no GitHub, selecione o workflow **Build Mycellia** e clique no botão **Run workflow**.
2. **Push de Tag**: Empurre uma tag que comece com `v` (ex: `v0.5.0`) para o repositório remoto:
   ```bash
   git tag v0.5.0
   git push origin v0.5.0
   ```

### Onde baixar os instaladores
Após o término da execução do workflow na aba **Actions**:
1. Clique no run correspondente do build.
2. Role a página até a seção **Artifacts** (no rodapé).
3. Baixe os artefatos empacotados:
   - `mycellia-windows-installer` (contendo o instalador `.exe` do Windows)
   - `mycellia-macos-bundles` (contendo a imagem `.dmg` e a pasta `.app` do macOS)

---

## 3. Nota sobre o Gatekeeper no macOS

Como os pacotes gerados no CI **não são assinados** com uma conta oficial de desenvolvedor da Apple, o macOS bloqueará a abertura direta do aplicativo exibindo uma mensagem de segurança ("desenvolvedor não identificado").

Para abrir o aplicativo pela primeira vez:
1. No Finder, localize o aplicativo `Mycellia.app` ou monte o `.dmg` e arraste o app.
2. Pressione a tecla **Control**, clique com o botão direito no ícone do aplicativo e escolha **Abrir**.
3. Na janela de aviso de segurança, clique em **Abrir**.
4. Nas inicializações subsequentes, o aplicativo abrirá normalmente.
