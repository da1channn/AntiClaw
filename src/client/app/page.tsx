"use client";
// =============================================================================
// AntiClaw - Main Page (Mobile-Optimized Agent Dashboard)
// =============================================================================

import { useEffect } from "react";
import { useAppStore } from "../lib/store";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ErrorToast, ConnectionBanner } from "../components/StatusOverlays";
import { Header } from "../components/Header";
import { AgentSidebar } from "../components/AgentSidebar";
import { ChatView } from "../components/ChatView";
import { MessageInput } from "../components/MessageInput";
import { AgentCreator } from "../components/AgentCreator";
import { IDEMonitor } from "../components/IDEMonitor";
import { CommitBridge } from "../components/CommitBridge";
import { ViewSwitcher } from "../components/ViewSwitcher";

export default function Home() {
  const { connect, connected, session, sidebarOpen, agentPanelOpen, viewMode } = useAppStore();

  useEffect(() => {
    connect();
  }, [connect]);

  // Close overlays on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const state = useAppStore.getState();
        if (state.agentPanelOpen) state.toggleAgentPanel();
        else if (state.sidebarOpen) state.toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  return (
    <ErrorBoundary>
      <div className="h-dvh flex flex-col overflow-hidden safe-top">
        <Header />
        <ConnectionBanner />
        <ViewSwitcher />
        <ErrorToast />

        <div className="flex-1 flex overflow-hidden relative">
          {/* Agent sidebar - slides in on mobile */}
          <div
            className={`
              fixed inset-y-0 left-0 z-30 w-72 transform transition-transform duration-300 ease-out
              md:relative md:translate-x-0 md:z-0
              ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            `}
          >
            <AgentSidebar />
          </div>

          {/* Sidebar overlay on mobile */}
          {sidebarOpen && (
            <button
              className="fixed inset-0 z-20 bg-black/50 md:hidden cursor-default"
              onClick={() => useAppStore.getState().toggleSidebar()}
              aria-label="サイドバーを閉じる"
              tabIndex={-1}
            />
          )}

          {/* Main content area */}
          <div className="flex-1 flex flex-col min-w-0">
            {viewMode === "commit-bridge" ? (
              <CommitBridge />
            ) : viewMode === "ide-monitor" ? (
              <IDEMonitor />
            ) : viewMode === "code-editor" ? (
              <div className="flex-1 flex items-center justify-center">
                <iframe
                  src="/code/"
                  className="w-full h-full border-0"
                  title="code-server"
                />
              </div>
            ) : session && session.agents.length > 0 ? (
              <>
                <ChatView />
                <MessageInput />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="text-center max-w-sm">
                  <div className="text-5xl mb-4">{"\u{1F916}"}</div>
                  <h2 className="text-xl font-semibold mb-2">
                    {connected ? "\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u3092\u4F5C\u6210" : "\u63A5\u7D9A\u4E2D..."}
                  </h2>
                  <p className="text-gray-400 text-sm mb-6">
                    {connected
                      ? "AI\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u30C1\u30FC\u30E0\u3092\u69CB\u6210\u3057\u3066\u3001Antigravity\u306E\u529B\u3092\u5916\u304B\u3089\u6D3B\u7528\u3057\u307E\u3057\u3087\u3046\u3002"
                      : "\u30B5\u30FC\u30D0\u30FC\u306B\u63A5\u7D9A\u3057\u3066\u3044\u307E\u3059..."}
                  </p>
                  {connected && <AgentCreator />}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Agent creator bottom sheet on mobile */}
        {agentPanelOpen && (
          <>
            <button
              className="fixed inset-0 z-40 bg-black/50 cursor-default"
              onClick={() => useAppStore.getState().toggleAgentPanel()}
              aria-label="\u30D1\u30CD\u30EB\u3092\u9589\u3058\u308B"
              tabIndex={-1}
            />
            <div className="bottom-sheet z-50 p-4 max-h-[60vh] overflow-y-auto" role="dialog" aria-label="\u30A8\u30FC\u30B8\u30A7\u30F3\u30C8\u4F5C\u6210">
              <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
              <AgentCreator />
            </div>
          </>
        )}
      </div>
    </ErrorBoundary>
  );
}
