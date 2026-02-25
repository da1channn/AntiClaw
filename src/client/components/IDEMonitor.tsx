"use client";
// =============================================================================
// IDE Monitor - Real-time Antigravity IDE chat monitor
// =============================================================================
// Displays the live chat state from Antigravity IDE via CDP bridge.
// Allows sending messages, stopping generation, and viewing agent activity.

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../lib/store";

function IDEMessageBubble({ message }: { message: { role: string; content: string; timestamp: number } }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`
          max-w-[90%] rounded-2xl px-3 py-2 text-sm
          ${isUser
            ? "bg-purple-600/80 text-white rounded-br-sm"
            : "bg-gray-800/70 text-gray-100 rounded-bl-sm"
          }
        `}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <div className={`text-[10px] mt-0.5 ${isUser ? "text-purple-200" : "text-gray-500"}`}>
          {new Date(message.timestamp).toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

export function IDEMonitor() {
  const { ideState, ideSendMessage, ideStopGeneration, ideRequestState } = useAppStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Request IDE state on mount
  useEffect(() => {
    ideRequestState();
  }, [ideRequestState]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ideState?.messages.length]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    ideSendMessage(trimmed);
    setInput("");
  };

  if (!ideState?.connected) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3 opacity-50">&#128268;</div>
          <h3 className="text-lg font-semibold mb-2 text-gray-300">Antigravity IDE 未接続</h3>
          <p className="text-gray-500 text-sm mb-4">
            IDEを以下のコマンドで起動してください:
          </p>
          <code className="block bg-gray-800/80 rounded-lg px-3 py-2 text-xs text-green-400 font-mono">
            antigravity . --remote-debugging-port=9222
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* IDE status bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/50 text-xs">
        <span className="w-2 h-2 rounded-full bg-green-400" />
        <span className="text-gray-400">Antigravity IDE</span>

        {ideState.activeModel && (
          <span className="px-2 py-0.5 rounded-full bg-purple-900/40 text-purple-300 text-[10px]">
            {ideState.activeModel}
          </span>
        )}

        {ideState.activeMode && (
          <span className="px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 text-[10px]">
            {ideState.activeMode}
          </span>
        )}

        {ideState.agentCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-orange-900/40 text-orange-300 text-[10px]">
            {ideState.agentCount} agent{ideState.agentCount !== 1 ? "s" : ""}
          </span>
        )}

        {ideState.isGenerating && (
          <span className="ml-auto flex items-center gap-1 text-yellow-400">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            生成中
          </span>
        )}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {ideState.messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-8">
            <p>IDEのチャット履歴がここに表示されます</p>
          </div>
        ) : (
          ideState.messages.map((msg, i) => (
            <IDEMessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-800/50 px-4 py-3 safe-bottom">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="IDEにメッセージを送信..."
            className="flex-1 bg-gray-800/50 rounded-xl px-3 py-2 text-sm resize-none outline-none
              focus:ring-1 focus:ring-purple-500/50 placeholder-gray-600"
            rows={1}
          />

          {ideState.isGenerating ? (
            <button
              onClick={ideStopGeneration}
              className="px-3 py-2 rounded-xl bg-red-600/80 text-white text-sm font-medium
                active:bg-red-700 transition-colors flex-shrink-0"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-3 py-2 rounded-xl bg-purple-600/80 text-white text-sm font-medium
                disabled:opacity-40 active:bg-purple-700 transition-colors flex-shrink-0"
            >
              送信
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
