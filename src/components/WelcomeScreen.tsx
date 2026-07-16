// Welcome screen (F3 — Spec 17): extraída intacta do App.tsx. Puramente apresentacional;
// abre/cria vault via dialog e lê tema/recentes do store. Zero relação com save/abas.
import { useAppStore } from '../store/appStore';
import { open as openDirectory } from '@tauri-apps/plugin-dialog';
import { FolderOpen, PlusCircle, Sun, Moon, FileText } from 'lucide-react';

export default function WelcomeScreen() {
  const { theme, toggleTheme, recentVaults, loadVault, notify } = useAppStore();

  const handleOpenVault = async () => {
    try {
      const selected = await openDirectory({
        directory: true,
        multiple: false,
        title: 'Selecionar Pasta do Vault',
      });
      if (selected && typeof selected === 'string') {
        await loadVault(selected);
      }
    } catch (err) {
      console.error('Failed to open vault:', err);
      notify('error', 'Falha ao abrir o diretório do vault.');
    }
  };

  const handleCreateVault = async () => {
    try {
      const selected = await openDirectory({
        directory: true,
        multiple: false,
        title: 'Escolha o diretório para criar o novo Vault',
      });
      if (selected && typeof selected === 'string') {
        await loadVault(selected);
      }
    } catch (err) {
      console.error('Failed to create vault:', err);
      notify('error', 'Falha ao selecionar diretório para criar o vault.');
    }
  };

  return (
    <main className="flex-1 flex flex-col justify-center items-center p-6 relative overflow-hidden">
      {theme === 'dark' && (
        <div className="absolute w-[500px] h-[500px] rounded-full bg-[var(--accent-muted)] filter blur-[100px] -z-10 pointer-events-none opacity-40 translate-y-[-50px]" />
      )}
      <div className="max-w-2xl w-full flex flex-col items-center text-center space-y-8">
        <div className="space-y-3">
          <div className="flex justify-center mb-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-[var(--substrate-raised)] transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
              aria-label="Alternar tema"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
          <h1 className="text-5xl font-display font-black tracking-tight text-[var(--text-primary)]">
            Bem-vindo ao{' '}
            <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--tag)] bg-clip-text text-transparent">
              Mycellia
            </span>
          </h1>
          <p className="text-[var(--text-secondary)] text-lg max-w-md mx-auto">
            Um editor de conhecimento local-first, offline e com conexões em grafo.
          </p>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full mt-4">
          <button
            onClick={handleOpenVault}
            className="glass-card p-6 rounded-xl flex flex-col items-center justify-center text-center gap-4 hover:scale-[1.01] cursor-pointer"
          >
            <div className="p-4 rounded-full bg-[var(--substrate-surface)] text-[var(--accent-dim)]">
              <FolderOpen className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[var(--text-primary)]">
                Abrir pasta existente
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Abra seu vault do Obsidian ou pasta local com notas Markdown
              </p>
            </div>
          </button>

          <button
            onClick={handleCreateVault}
            className="glass-card p-6 rounded-xl flex flex-col items-center justify-center text-center gap-4 hover:scale-[1.01] cursor-pointer"
          >
            <div className="p-4 rounded-full bg-[var(--substrate-surface)] text-[var(--accent)]">
              <PlusCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-display font-bold text-base text-[var(--text-primary)]">
                Criar novo Vault
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Crie uma nova pasta vazia e comece a tecer sua teia de conhecimento
              </p>
            </div>
          </button>
        </div>

        {/* Recent Vaults */}
        <div className="w-full max-w-md pt-6 border-t border-[var(--border-default)]">
          <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Vaults Recentes
          </h4>
          {recentVaults.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)] italic">
              Nenhum vault aberto recentemente.
            </div>
          ) : (
            <div className="space-y-2">
              {recentVaults.map((vault) => (
                <button
                  key={vault}
                  onClick={() => loadVault(vault)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[var(--substrate-raised)] hover:bg-[var(--substrate-surface)] border border-[var(--border-default)] text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="w-4 h-4 text-[var(--tag)] flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-[var(--text-primary)] truncate">
                        {vault.split('\\').pop() || vault.split('/').pop()}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate font-mono mt-0.5">
                        {vault}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
