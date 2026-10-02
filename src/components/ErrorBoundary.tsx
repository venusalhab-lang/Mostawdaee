import React, { Component, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Unhandled runtime exception caught by boundary:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-6 text-center select-none font-sans">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-[2.5rem] border border-gray-100 dark:border-gray-700 shadow-2xl flex flex-col items-center space-y-6">
            <div className="w-16 h-16 bg-rose-50 dark:bg-rose-950/30 rounded-full flex items-center justify-center text-rose-600 dark:text-rose-400">
              <AlertTriangle size={32} className="animate-bounce" />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-gray-900 dark:text-white">
                Something went wrong
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Mustawda'i encountered an unexpected rendering error. No data was lost, but a container refresh is required.
              </p>
            </div>

            {this.state.error && (
              <pre className="w-full text-xs text-left text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/20 p-4 rounded-xl overflow-x-auto max-h-32 font-mono border border-rose-100 dark:border-rose-900/10">
                {this.state.error.message}
              </pre>
            )}

            <button
              onClick={this.handleReset}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-sm uppercase flex items-center justify-center gap-2 shadow-lg hover:shadow-indigo-500/10 transition-all active:scale-95"
            >
              <RefreshCw size={18} />
              Reboot Container
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
