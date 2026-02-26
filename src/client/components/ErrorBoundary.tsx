"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-dvh flex items-center justify-center bg-gray-950 p-6">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-4">&#x26A0;&#xFE0F;</div>
            <h2 className="text-lg font-semibold text-gray-200 mb-2">
              予期しないエラーが発生しました
            </h2>
            <p className="text-gray-500 text-sm mb-4">
              {this.state.error?.message || "Unknown error"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium
                hover:bg-blue-500 active:bg-blue-700 transition-colors"
            >
              リロード
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
