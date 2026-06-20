"use client";

/**
 * ErrorBoundary — React class component for catching render-time errors.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeWidget />
 *   </ErrorBoundary>
 *
 * With a custom fallback:
 *   <ErrorBoundary fallback={<p>Widget failed to load.</p>}>
 *     <SomeWidget />
 *   </ErrorBoundary>
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { trackError } from "@/lib/analytics/tracker";
import Link from "next/link";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children:  ReactNode;
  /** Optional custom fallback. If omitted, renders the default card. */
  fallback?: ReactNode;
  /** Context label for error tracking (e.g. "CaseDetailWidget") */
  context?:  string;
}

interface State {
  hasError:   boolean;
  errorMsg:   string;
  errorDigest?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError:  true,
      errorMsg:  error.message,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    trackError(error, {
      page:   this.props.context ?? "unknown",
      action: "render",
      digest: info.componentStack?.split("\n")[1]?.trim(),
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMsg: "" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return <DefaultFallback onReset={this.handleReset} />;
  }
}

// ─── Default fallback UI ───────────────────────────────────────────────────────

function DefaultFallback({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
        <AlertCircle className="w-7 h-7 text-red-400" />
      </div>
      <p className="text-sm font-bold text-gray-800 mb-1">
        This section failed to load
      </p>
      <p className="text-xs text-gray-400 max-w-xs leading-relaxed mb-5">
        An unexpected error occurred. Try refreshing or go back to the dashboard.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={onReset}
          className="flex items-center gap-1.5 text-xs font-bold text-[#009966] border border-emerald-200 px-3.5 py-2 rounded-xl hover:bg-emerald-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Try Again
        </button>
        <Link
          href="/"
          className="text-xs font-semibold text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
