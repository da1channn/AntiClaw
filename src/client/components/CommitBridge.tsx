"use client";
// =============================================================================
// CommitBridge - Bed-to-Commit Pipeline UI
// =============================================================================
// Full pipeline view: task input -> agent progress -> diff review -> commit approval.
// Designed for mobile-first interaction.

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../lib/store";
import type { PipelineStage, PipelineStageStatus } from "../../shared/types";

const STAGE_STATUS_COLORS: Record<PipelineStageStatus, string> = {
  pending: "bg-gray-600",
  running: "bg-blue-400 animate-pulse",
  completed: "bg-green-400",
  error: "bg-red-400",
  skipped: "bg-gray-500",
};

const STAGE_STATUS_LABELS: Record<PipelineStageStatus, string> = {
  pending: "\u5F85\u6A5F",
  running: "\u5B9F\u884C\u4E2D",
  completed: "\u5B8C\u4E86",
  error: "\u30A8\u30E9\u30FC",
  skipped: "\u30B9\u30AD\u30C3\u30D7",
};

const ROLE_LABELS: Record<string, { icon: string; label: string }> = {
  architect: { icon: "\u{1F3D7}", label: "Architect" },
  frontend: { icon: "\u{1F3A8}", label: "Frontend" },
  backend: { icon: "\u{2699}", label: "Backend" },
  tester: { icon: "\u{1F50D}", label: "Tester" },
  reviewer: { icon: "\u{1F441}", label: "Reviewer" },
};

function StageCard({ stage, streamContent }: { stage: PipelineStage; streamContent?: string }) {
  const [expanded, setExpanded] = useState(false);
  const roleInfo = ROLE_LABELS[stage.role] || { icon: "\u{1F916}", label: stage.role };
  const content = stage.output || streamContent;

  return (
    <div className="border border-gray-800/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-800/30 transition-colors"
      >
        <span className="text-base">{roleInfo.icon}</span>
        <span className="text-sm font-medium flex-1 text-left">{roleInfo.label}</span>
        <span className={`w-2 h-2 rounded-full ${STAGE_STATUS_COLORS[stage.status]}`} />
        <span className="text-[10px] text-gray-500">{STAGE_STATUS_LABELS[stage.status]}</span>
        {stage.completedAt && stage.startedAt && (
          <span className="text-[10px] text-gray-600">
            {((stage.completedAt - stage.startedAt) / 1000).toFixed(1)}s
          </span>
        )}
        <svg
          className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && content && (
        <div className="border-t border-gray-800/50 px-3 py-2 max-h-60 overflow-y-auto">
          <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words font-mono">
            {content}
          </pre>
          {stage.status === "running" && <span className="streaming-cursor" />}
        </div>
      )}

      {expanded && stage.error && (
        <div className="border-t border-gray-800/50 px-3 py-2 bg-red-900/10">
          <p className="text-xs text-red-400">{stage.error}</p>
        </div>
      )}
    </div>
  );
}

function PipelineProgress() {
  const { activePipeline, pipelineStageStreams, cancelPipeline } = useAppStore();
  if (!activePipeline) return null;

  const completedStages = activePipeline.stages.filter((s) => s.status === "completed").length;
  const totalStages = activePipeline.stages.length;
  const progress = totalStages > 0 ? (completedStages / totalStages) * 100 : 0;

  const isRunning = ["planning", "executing", "reviewing"].includes(activePipeline.status);

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-gray-400">{completedStages}/{totalStages}</span>
        {isRunning && (
          <button
            onClick={() => cancelPipeline(activePipeline.id)}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-900/20"
          >
            \u30AD\u30E3\u30F3\u30BB\u30EB
          </button>
        )}
      </div>

      {/* Task description */}
      <div className="px-1">
        <p className="text-xs text-gray-500">\u30BF\u30B9\u30AF:</p>
        <p className="text-sm text-gray-300 mt-0.5">{activePipeline.task}</p>
      </div>

      {/* Stage cards */}
      <div className="space-y-2">
        {activePipeline.stages.map((stage) => (
          <StageCard
            key={stage.id}
            stage={stage}
            streamContent={pipelineStageStreams.get(stage.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CommitApproval() {
  const { activePipeline, approveCommit, rejectCommit, lastCommitResult } = useAppStore();
  const [commitMessage, setCommitMessage] = useState("");
  const [shouldPush, setShouldPush] = useState(false);

  useEffect(() => {
    if (activePipeline?.commitRequest?.message) {
      setCommitMessage(activePipeline.commitRequest.message);
    }
  }, [activePipeline?.commitRequest?.message]);

  if (!activePipeline || activePipeline.status !== "awaiting_approval") return null;
  if (!activePipeline.commitRequest) return null;

  const { pipelineId, approvalToken, branch, files } = activePipeline.commitRequest;

  return (
    <div className="space-y-3 border border-yellow-800/50 rounded-xl p-3 bg-yellow-900/10">
      <div className="flex items-center gap-2">
        <span className="text-base">\u{1F4CB}</span>
        <h4 className="text-sm font-semibold text-yellow-300">\u30B3\u30DF\u30C3\u30C8\u627F\u8A8D</h4>
        <span className="ml-auto text-[10px] text-gray-500 px-2 py-0.5 rounded-full bg-gray-800">
          {branch}
        </span>
      </div>

      {/* Files changed */}
      <div>
        <p className="text-[10px] text-gray-500 mb-1">\u5909\u66F4\u30D5\u30A1\u30A4\u30EB ({files.length})</p>
        <div className="space-y-0.5 max-h-32 overflow-y-auto">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full ${
                file.action === "add" ? "bg-green-400" :
                file.action === "delete" ? "bg-red-400" : "bg-yellow-400"
              }`} />
              <span className="text-gray-400 font-mono truncate">{file.path}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Commit message editor */}
      <div>
        <label className="text-[10px] text-gray-500 block mb-1">\u30B3\u30DF\u30C3\u30C8\u30E1\u30C3\u30BB\u30FC\u30B8</label>
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          className="w-full bg-gray-800/50 rounded-lg px-3 py-2 text-xs font-mono resize-none
            outline-none focus:ring-1 focus:ring-yellow-500/50"
          rows={2}
        />
      </div>

      {/* Push toggle */}
      <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
        <input
          type="checkbox"
          checked={shouldPush}
          onChange={(e) => setShouldPush(e.target.checked)}
          className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30"
        />
        \u30B3\u30DF\u30C3\u30C8\u5F8C\u306Bpush
      </label>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => rejectCommit(pipelineId)}
          className="flex-1 px-3 py-2.5 rounded-xl border border-gray-700 text-gray-400
            text-xs font-medium hover:bg-gray-800 active:bg-gray-700 transition-colors"
        >
          \u62D2\u5426
        </button>
        <button
          onClick={() => approveCommit(pipelineId, approvalToken, commitMessage, shouldPush)}
          className="flex-1 px-3 py-2.5 rounded-xl bg-green-600 text-white
            text-xs font-medium hover:bg-green-500 active:bg-green-700 transition-colors"
        >
          \u30B3\u30DF\u30C3\u30C8\u627F\u8A8D
        </button>
      </div>
    </div>
  );
}

function CommitResultBanner() {
  const { lastCommitResult } = useAppStore();
  if (!lastCommitResult) return null;

  return (
    <div className="border border-green-800/50 rounded-xl p-3 bg-green-900/10">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">\u2705</span>
        <h4 className="text-sm font-semibold text-green-300">\u30B3\u30DF\u30C3\u30C8\u5B8C\u4E86</h4>
      </div>
      <div className="space-y-1 text-xs text-gray-400">
        <p><span className="text-gray-500">hash:</span> <code className="text-green-400">{lastCommitResult.hash.slice(0, 8)}</code></p>
        <p><span className="text-gray-500">branch:</span> {lastCommitResult.branch}</p>
        <p><span className="text-gray-500">message:</span> {lastCommitResult.message}</p>
        <p>
          <span className="text-green-400">+{lastCommitResult.insertions}</span>
          {" / "}
          <span className="text-red-400">-{lastCommitResult.deletions}</span>
          {" "}({lastCommitResult.filesChanged} files)
        </p>
        {lastCommitResult.pushed && (
          <p className="text-blue-400">\u2191 Pushed to remote</p>
        )}
      </div>
    </div>
  );
}

export function CommitBridge() {
  const { activePipeline, startPipeline, requestGitStatus, gitStatus, connected } = useAppStore();
  const [taskInput, setTaskInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestGitStatus();
  }, [requestGitStatus]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activePipeline?.status, activePipeline?.stages]);

  const handleStart = () => {
    const trimmed = taskInput.trim();
    if (!trimmed) return;
    startPipeline(trimmed);
    setTaskInput("");
  };

  const isRunning = activePipeline && ["planning", "executing", "reviewing"].includes(activePipeline.status);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Git status bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/50 text-xs">
        <span className="text-gray-400">\u{1F33F}</span>
        {gitStatus ? (
          <>
            <span className="font-mono text-green-400">{gitStatus.branch}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${gitStatus.clean ? "bg-green-400" : "bg-yellow-400"}`} />
            {gitStatus.ahead > 0 && (
              <span className="text-blue-400">\u2191{gitStatus.ahead}</span>
            )}
            {gitStatus.behind > 0 && (
              <span className="text-orange-400">\u2193{gitStatus.behind}</span>
            )}
            {!gitStatus.clean && (
              <span className="text-yellow-400">
                {gitStatus.modified.length}M {gitStatus.untracked.length}U
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-500">\u8AAD\u307F\u8FBC\u307F\u4E2D...</span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Empty state */}
        {!activePipeline && !isRunning && (
          <div className="text-center mt-8">
            <div className="text-4xl mb-3">\u{1F6CF}\u{FE0F}\u27A1\u{1F4E6}</div>
            <h3 className="text-lg font-semibold mb-1 text-gray-200">Bed-to-Commit Bridge</h3>
            <p className="text-gray-500 text-xs max-w-xs mx-auto">
              \u30BF\u30B9\u30AF\u3092\u5165\u529B\u3059\u308B\u3060\u3051\u3067\u3001AI\u30C1\u30FC\u30E0\u304C\u8A2D\u8A08\u30FB\u5B9F\u88C5\u30FB\u30C6\u30B9\u30C8\u30FB\u30EC\u30D3\u30E5\u30FC\u3092\u884C\u3044\u3001
              \u627F\u8A8D\u5F8C\u306B\u81EA\u52D5\u30B3\u30DF\u30C3\u30C8\u3057\u307E\u3059\u3002
            </p>
          </div>
        )}

        {/* Pipeline progress */}
        <PipelineProgress />

        {/* Commit approval */}
        <CommitApproval />

        {/* Commit result */}
        <CommitResultBanner />

        <div ref={bottomRef} />
      </div>

      {/* Task input */}
      <div className="border-t border-gray-800/50 px-4 py-3 safe-bottom">
        <div className="flex gap-2">
          <textarea
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleStart();
              }
            }}
            placeholder={
              isRunning
                ? "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u5B9F\u884C\u4E2D..."
                : "\u30BF\u30B9\u30AF\u3092\u5165\u529B (e.g. \u300Cadd user authentication\u300D)"
            }
            disabled={!!isRunning || !connected}
            className="flex-1 bg-gray-800/50 rounded-xl px-3 py-2.5 text-sm resize-none outline-none
              focus:ring-1 focus:ring-blue-500/50 placeholder-gray-600 disabled:opacity-50"
            rows={1}
          />
          <button
            onClick={handleStart}
            disabled={!taskInput.trim() || !!isRunning || !connected}
            className="px-4 py-2.5 rounded-xl bg-blue-600/80 text-white text-sm font-medium
              disabled:opacity-40 active:bg-blue-700 transition-colors flex-shrink-0"
          >
            \u958B\u59CB
          </button>
        </div>
      </div>
    </div>
  );
}
