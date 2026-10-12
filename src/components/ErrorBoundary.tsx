import React, { Component, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { isChunkLoadError } from '../lib/lazyWithRetry';

interface Props {
  children: React.ReactNode;
  /** 'screen' keeps the rest of the app usable; 'app' is the last line of defence. */
  variant?: 'app' | 'screen';
  /** Omit for the app-level boundary, where the language may not be known yet: both languages are shown. */
  isRtl?: boolean;
  /** Changing this (e.g. the active screen) clears the error. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Render error caught by boundary:', error, errorInfo);
  }

  public componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  private reload = () => window.location.reload();

  public render() {
    if (!this.state.error) return this.props.children;

    const { variant = 'app', isRtl } = this.props;
    // A screen bundle that failed to download stays failed until the page reloads.
    const canRetry = variant === 'screen' && !isChunkLoadError(this.state.error);
    const ar = {
      title: 'تعذّر عرض هذه الشاشة',
      body: 'البيانات المحفوظة على الخادم لم تتأثر. ما أدخلته في هذه الشاشة ولم تحفظه قد يضيع.',
      retry: 'إعادة المحاولة',
      reload: 'إعادة تحميل التطبيق',
    };
    const en = {
      title: 'This screen could not be displayed',
      body: 'Data saved on the server is not affected. Anything typed on this screen and not yet saved may be lost.',
      retry: 'Try again',
      reload: 'Reload the app',
    };
    const texts = isRtl === undefined ? null : isRtl ? ar : en;

    return (
      <div
        role="alert"
        dir={isRtl === false ? 'ltr' : 'rtl'}
        className={`${variant === 'app' ? 'min-h-screen' : 'min-h-[40vh]'} flex items-center justify-center p-6 text-center`}
      >
        <div className="max-w-md w-full bg-white dark:bg-gray-800 p-8 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-xl flex flex-col items-center gap-5">
          <div className="w-14 h-14 bg-rose-50 dark:bg-rose-950/30 rounded-full flex items-center justify-center text-rose-600 dark:text-rose-400">
            <AlertTriangle size={28} />
          </div>
          {texts ? (
            <div className="space-y-2">
              <h2 className="text-xl font-black text-gray-900 dark:text-white">{texts.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{texts.body}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-xl font-black text-gray-900 dark:text-white">{ar.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{ar.body}</p>
              <p dir="ltr" className="text-xs text-gray-400 leading-relaxed">{en.title}. {en.body}</p>
            </div>
          )}
          <div className="w-full flex flex-col gap-2">
            {canRetry && (
              <button
                type="button"
                onClick={this.retry}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} />
                {(texts || ar).retry}
              </button>
            )}
            <button
              type="button"
              onClick={this.reload}
              className={`w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 ${
                canRetry
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              <RefreshCw size={16} />
              {texts ? texts.reload : `${ar.reload} · ${en.reload}`}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
