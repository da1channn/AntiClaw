"use client";

import { useEffect } from "react";
import { useAppStore } from "../lib/store";

/** Floating error toast - auto-dismisses after 5 seconds. */
export function ErrorToast() {
  const { lastError, lastErrorAt, clearError } = useAppStore();

  useEffect(() => {
    if (!lastErrorAt) return;
    const timer = setTimeout(clearError, 5000);
    return () => clearTimeout(timer);
  }, [lastErrorAt, clearError]);

  if (!lastError) return null;

  return (
    <div
      role="alert"
      className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[90%]
        bg-red-900/90 backdrop-blur-sm border border-red-700/50 rounded-xl
        px-4 py-2.5 shadow-lg animate-slide-down"
    >
      <div className="flex items-start gap-2">
        <span className="text-red-300 flex-shrink-0 mt-0.5">&#x26A0;</span>
        <p className="text-xs text-red-200 flex-1 break-words">{lastError}</p>
        <button
          onClick={clearError}
          className="text-red-400 hover:text-red-200 flex-shrink-0 p-0.5"
          aria-label="エラーを閉じる"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** Offline / disconnected banner - shown below header. */
export function ConnectionBanner() {
  const connected = useAppStore((s) => s.connected);

  if (connected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-yellow-900/60 border-b border-yellow-800/40 px-4 py-1.5
        flex items-center justify-center gap-2 text-xs text-yellow-300"
    >
      <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
      接続が切断されました。再接続中...
    </div>
  );
}
