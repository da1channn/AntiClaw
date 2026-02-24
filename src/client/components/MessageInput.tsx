"use client";

import { useState, useRef, useCallback } from "react";
import { useAppStore } from "../lib/store";

export function MessageInput() {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, activeAgentId, session } = useAppStore();

  const activeAgent = session?.agents.find((a) => a.id === activeAgentId);
  const isExecuting = activeAgent?.status === "executing";

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || !activeAgentId || isExecuting) return;

    sendMessage(activeAgentId, trimmed);
    setText("");

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, activeAgentId, isExecuting, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  };

  return (
    <div className="glass border-t border-gray-800/50 p-3 safe-bottom safe-left safe-right">
      <div className="flex items-end gap-2 max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            isExecuting
              ? "エージェント実行中..."
              : activeAgent
              ? `${activeAgent.name} にメッセージを送信...`
              : "エージェントを選択してください"
          }
          disabled={!activeAgentId || isExecuting}
          rows={1}
          className="
            flex-1 bg-gray-800/50 border border-gray-700/50 rounded-xl
            px-4 py-2.5 text-sm placeholder:text-gray-500
            focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30
            resize-none disabled:opacity-50
            transition-colors
          "
        />

        <button
          onClick={handleSend}
          disabled={!text.trim() || !activeAgentId || isExecuting}
          className="
            p-2.5 rounded-xl bg-blue-600 text-white
            hover:bg-blue-500 active:bg-blue-700
            disabled:opacity-30 disabled:cursor-not-allowed
            transition-colors flex-shrink-0
          "
          aria-label="送信"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
