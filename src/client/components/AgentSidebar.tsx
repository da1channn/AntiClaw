"use client";

import { useAppStore } from "../lib/store";
import { AgentCreator } from "./AgentCreator";
import type { Agent, AgentStatus } from "../../shared/types";

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "bg-gray-400",
  planning: "bg-yellow-400",
  executing: "bg-blue-400 animate-pulse",
  reviewing: "bg-purple-400",
  error: "bg-red-400",
  completed: "bg-green-400",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "待機中",
  planning: "計画中",
  executing: "実行中",
  reviewing: "レビュー中",
  error: "エラー",
  completed: "完了",
};

const ROLE_ICONS: Record<string, string> = {
  architect: "\u{1F6E0}\uFE0F",
  frontend: "\u{1F3A8}",
  backend: "\u2699\uFE0F",
  tester: "\u{1F50E}",
  reviewer: "\u{1F441}\uFE0F",
  devops: "\u2601\uFE0F",
  general: "\u{1F916}",
};

function AgentCard({ agent }: { agent: Agent }) {
  const { activeAgentId, setActiveAgent, deleteAgent, stopAgent, toggleSidebar } = useAppStore();
  const isActive = activeAgentId === agent.id;

  return (
    <div
      className={`
        p-3 rounded-xl cursor-pointer transition-all duration-200
        ${isActive
          ? "bg-blue-500/10 border border-blue-500/30"
          : "hover:bg-gray-800/50 border border-transparent"
        }
      `}
      onClick={() => {
        setActiveAgent(agent.id);
        // Close sidebar on mobile after selecting
        if (window.innerWidth < 768) toggleSidebar();
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-lg flex-shrink-0" role="img" aria-label={agent.role}>
          {ROLE_ICONS[agent.role] || ROLE_ICONS.general}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{agent.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[agent.status]}`} />
            <span className="text-xs text-gray-400">{STATUS_LABELS[agent.status]}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0">
          {agent.status === "executing" && (
            <button
              onClick={(e) => { e.stopPropagation(); stopAgent(agent.id); }}
              className="p-2.5 -m-0.5 rounded hover:bg-gray-700 text-yellow-400"
              aria-label={`${agent.name}を停止`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`${agent.name}を削除しますか？`)) deleteAgent(agent.id);
            }}
            className="p-2.5 -m-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
            aria-label={`${agent.name}を削除`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Current task preview */}
      {agent.currentTask && (
        <p className="text-xs text-gray-500 mt-1.5 truncate pl-7">{agent.currentTask}</p>
      )}
    </div>
  );
}

export function AgentSidebar() {
  const { session } = useAppStore();
  const agents = session?.agents ?? [];

  return (
    <aside className="h-full glass border-r border-gray-800/50 flex flex-col overflow-hidden">
      <div className="p-4 border-b border-gray-800/50">
        <h2 className="font-semibold text-sm text-gray-300">Agent Team</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {agents.length}/4 エージェント
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>

      <div className="p-3 border-t border-gray-800/50 hidden md:block">
        <AgentCreator compact />
      </div>
    </aside>
  );
}
