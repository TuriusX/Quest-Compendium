import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in Quest Compendium:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen bg-[#0c0d14] text-zinc-100 flex flex-col items-center justify-center p-6 text-center select-none font-sans">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-xl font-bold font-fantasy tracking-wider mb-2 text-white">
            COMPENDIUM RECOVERY
          </h1>
          <p className="text-xs text-zinc-400 max-w-md mb-6 leading-relaxed">
            An unexpected interface error occurred. You can safely recover your session by reloading the Compendium.
          </p>
          {this.state.error && (
            <div className="bg-black/60 border border-white/10 rounded-xl p-3 mb-6 max-w-lg w-full text-left overflow-auto max-h-32 text-[11px] font-mono text-zinc-400">
              {this.state.error.message}
            </div>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/30 transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reload Compendium</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
