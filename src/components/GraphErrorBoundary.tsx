import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GraphErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in GraphView:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[var(--substrate-void)] p-6 font-sans">
          <div className="max-w-md w-full p-6 rounded-lg border border-danger/30 bg-danger-muted shadow-[0_8px_24px_rgba(237,115,97,0.1)] flex flex-col items-center text-center gap-4">
            <div className="p-3 rounded-full bg-danger/10 text-danger">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="text-sm font-semibold text-danger tracking-wide">
              Falha ao Carregar o Grafo
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Ocorreu uma falha inesperada ao renderizar a visualização bioluminescente.
            </p>
            {this.state.error && (
              <pre className="w-full p-2 bg-black/40 rounded text-[10px] text-[var(--text-muted)] text-left overflow-x-auto max-h-24">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-danger text-[var(--substrate-void)] hover:bg-[var(--danger)]/90 active:scale-95 transition-all text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Tentar Novamente</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
