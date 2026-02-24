"use client";

import { useAppStore } from "../lib/store";

export function Header() {
  const { connected, session, sidebarOpen, toggleSidebar, toggleAgentPanel } = useAppStore();

  const activeAgents = session?.agents.filter(
    (a) => a.status !== "completed" && a.status !== "error"
  ).length ?? 0;

  return (
    <header className="glass border-b border-gray-800/50 px-4 py-3 flex items-center gap-3 safe-left safe-right">
      {/* Hamburger menu - mobile only */}
      <button
        onClick={toggleSidebar}
        className="md:hidden p-1.5 rounded-lg hover:bg-gray-800 active:bg-gray-700 transition-colors"
        aria-label="Toggle sidebar"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {sidebarOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Logo */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          AntiClaw
        </span>

        {/* Connection status */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            connected ? "bg-green-400" : "bg-red-400 animate-pulse"
          }`}
        />
      </div>

      {/* Active agents badge */}
      {activeAgents > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          {activeAgents} agent{activeAgents !== 1 ? "s" : ""}
        </div>
      )}

      {/* Add agent button - mobile */}
      <button
        onClick={toggleAgentPanel}
        className="md:hidden p-1.5 rounded-lg hover:bg-gray-800 active:bg-gray-700 transition-colors"
        aria-label="Add agent"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* User email */}
      {session?.user.email && (
        <span className="hidden sm:block text-xs text-gray-500 truncate max-w-[120px]">
          {session.user.email}
        </span>
      )}
    </header>
  );
}
