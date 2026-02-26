"use client";

import { useState } from "react";
import { useAppStore } from "../lib/store";
import type { AgentRole } from "../../shared/types";

interface RoleOption {
  role: AgentRole;
  icon: string;
  label: string;
  description: string;
}

const ROLES: RoleOption[] = [
  { role: "general", icon: "\u{1F916}", label: "General", description: "汎用AIアシスタント" },
  { role: "architect", icon: "\u{1F3D7}", label: "Architect", description: "設計・アーキテクチャ" },
  { role: "frontend", icon: "\u{1F3A8}", label: "Frontend", description: "フロントエンド開発" },
  { role: "backend", icon: "\u{2699}", label: "Backend", description: "バックエンド開発" },
  { role: "tester", icon: "\u{1F50D}", label: "Tester", description: "テスト・QA" },
  { role: "reviewer", icon: "\u{1F441}", label: "Reviewer", description: "コードレビュー" },
  { role: "devops", icon: "\u{2601}", label: "DevOps", description: "インフラ・デプロイ" },
];

const MODELS = [
  { value: "gemini-3-pro", label: "Gemini 3 Pro" },
  { value: "gemini-3-flash", label: "Gemini 3 Flash" },
];

export function AgentCreator({ compact = false }: { compact?: boolean }) {
  const [selectedRole, setSelectedRole] = useState<AgentRole>("general");
  const [selectedModel, setSelectedModel] = useState(MODELS[0].value);
  const { createAgent, toggleAgentPanel } = useAppStore();

  const handleCreate = () => {
    createAgent(selectedRole, selectedModel);
    // Close bottom sheet on mobile
    if (window.innerWidth < 768) {
      toggleAgentPanel();
    }
  };

  if (compact) {
    return (
      <div className="space-y-2">
        <select
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value as AgentRole)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
        >
          {ROLES.map((r) => (
            <option key={r.role} value={r.role}>
              {r.icon} {r.label}
            </option>
          ))}
        </select>
        <button
          onClick={handleCreate}
          className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg px-3 py-2 text-xs font-medium transition-colors"
        >
          + エージェント追加
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full max-w-sm mx-auto">
      <h3 className="font-semibold text-sm text-center">エージェントを追加</h3>

      {/* Role grid */}
      <div className="grid grid-cols-2 gap-2">
        {ROLES.map((r) => (
          <button
            key={r.role}
            onClick={() => setSelectedRole(r.role)}
            className={`
              p-3 rounded-xl border text-left transition-all
              ${selectedRole === r.role
                ? "border-blue-500/50 bg-blue-500/10"
                : "border-gray-700/50 hover:bg-gray-800/50"
              }
            `}
          >
            <div className="text-lg mb-1">{r.icon}</div>
            <div className="text-xs font-medium">{r.label}</div>
            <div className="text-[10px] text-gray-500">{r.description}</div>
          </button>
        ))}
      </div>

      {/* Model selector */}
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Model</label>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Create button */}
      <button
        onClick={handleCreate}
        className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl px-4 py-3 font-medium transition-colors"
      >
        エージェントを作成
      </button>
    </div>
  );
}
