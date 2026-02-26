"use client";
// =============================================================================
// ViewSwitcher - Tab bar for switching between Agents, IDE Monitor, and Code Editor
// =============================================================================

import { useAppStore } from "../lib/store";

const TABS = [
  { mode: "agents" as const, label: "Agents" },
  { mode: "commit-bridge" as const, label: "Commit" },
  { mode: "ide-monitor" as const, label: "IDE" },
  { mode: "code-editor" as const, label: "Editor" },
] as const;

export function ViewSwitcher() {
  const { viewMode, setViewMode, ideState, activePipeline } = useAppStore();

  return (
    <div className="flex border-b border-gray-800/50 px-2 gap-1 safe-left safe-right">
      {TABS.map((tab) => (
        <button
          key={tab.mode}
          onClick={() => setViewMode(tab.mode)}
          className={`
            relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors
            ${viewMode === tab.mode
              ? "text-white border-b-2 border-blue-400"
              : "text-gray-500 hover:text-gray-300"
            }
          `}
        >
          {tab.label}

          {/* Pipeline status indicator */}
          {tab.mode === "commit-bridge" && activePipeline && ["planning", "executing", "reviewing"].includes(activePipeline.status) && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
          {tab.mode === "commit-bridge" && activePipeline?.status === "awaiting_approval" && (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
          )}

          {/* IDE connection indicator */}
          {tab.mode === "ide-monitor" && ideState?.connected && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          )}

          {/* IDE generating indicator */}
          {tab.mode === "ide-monitor" && ideState?.isGenerating && (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
          )}
        </button>
      ))}
    </div>
  );
}
