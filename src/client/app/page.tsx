"use client";
// =============================================================================
// AntiClaw - Main Page (Mobile-Optimized Agent Dashboard)
// =============================================================================

import { useEffect } from "react";
import { useAppStore } from "../lib/store";
import { Header } from "../components/Header";
import { AgentSidebar } from "../components/AgentSidebar";
import { ChatView } from "../components/ChatView";
import { MessageInput } from "../components/MessageInput";
import { AgentCreator } from "../components/AgentCreator";

export default function Home() {
  const { connect, connected, session, sidebarOpen, agentPanelOpen } = useAppStore();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="h-dvh flex flex-col overflow-hidden safe-top">
      <Header />

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
          <div
            className="fixed inset-0 z-20 bg-black/50 md:hidden"
            onClick={() => useAppStore.getState().toggleSidebar()}
          />
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {session && session.agents.length > 0 ? (
            <>
              <ChatView />
              <MessageInput />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center max-w-sm">
                <div className="text-5xl mb-4">&#129302;</div>
                <h2 className="text-xl font-semibold mb-2">
                  {connected ? "エージェントを作成" : "接続中..."}
                </h2>
                <p className="text-gray-400 text-sm mb-6">
                  {connected
                    ? "AIエージェントチームを構成して、Antigravityの力を外から活用しましょう。"
                    : "サーバーに接続しています..."}
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
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => useAppStore.getState().toggleAgentPanel()}
          />
          <div className="bottom-sheet z-50 p-4 max-h-[60vh] overflow-y-auto">
            <div className="w-12 h-1 bg-gray-600 rounded-full mx-auto mb-4" />
            <AgentCreator />
          </div>
        </>
      )}
    </div>
  );
}
