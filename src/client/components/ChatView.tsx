"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "../lib/store";
import type { AgentMessage, Artifact } from "../../shared/types";

function ArtifactBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-gray-700/50">
      <div className="bg-gray-800/50 px-3 py-1.5 flex items-center gap-2 text-xs">
        <span className="text-gray-400">
          {artifact.type === "code" ? "&#128196;" : "&#128203;"}
        </span>
        <span className="text-gray-300 font-medium truncate">{artifact.title}</span>
        {artifact.language && (
          <span className="ml-auto text-gray-500">{artifact.language}</span>
        )}
      </div>
      <pre className="p-3 text-xs overflow-x-auto bg-gray-900/50">
        <code>{artifact.content}</code>
      </pre>
    </div>
  );
}

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`
          max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2.5
          ${isUser
            ? "bg-blue-600 text-white rounded-br-sm"
            : "bg-gray-800/70 text-gray-100 rounded-bl-sm"
          }
        `}
      >
        <div className="prose-chat" dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }} />

        {message.artifacts?.map((artifact) => (
          <ArtifactBlock key={artifact.id} artifact={artifact} />
        ))}

        <div className={`text-[10px] mt-1 ${isUser ? "text-blue-200" : "text-gray-500"}`}>
          {new Date(message.timestamp).toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] md:max-w-[70%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-gray-800/70">
        <div className="prose-chat streaming-cursor" dangerouslySetInnerHTML={{ __html: formatMarkdown(content) }} />
      </div>
    </div>
  );
}

/** Escape HTML special characters to prevent XSS. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Simple markdown to HTML (code blocks, bold, italic, inline code). Input is escaped first. */
function formatMarkdown(text: string): string {
  // Extract code blocks first (protect from escaping)
  const codeBlocks: string[] = [];
  const withPlaceholders = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code class="language-${escapeHtml(lang || "")}">${escapeHtml(code)}</code></pre>`);
    return `\x00CB${idx}\x00`;
  });

  // Escape remaining text
  let result = escapeHtml(withPlaceholders);

  // Restore code blocks
  result = result.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx, 10)]);

  return result
    // Inline code
    .replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Line breaks
    .replace(/\n/g, '<br/>');
}

export function ChatView() {
  const { session, activeAgentId, streamingMessages } = useAppStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = (session?.messages ?? []).filter(
    (m) => m.agentId === activeAgentId
  );

  const activeAgent = session?.agents.find((a) => a.id === activeAgentId);

  // Find streaming message for active agent
  const streaming = Array.from(streamingMessages.values()).find(
    (s) => s.agentId === activeAgentId
  );

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streaming?.content]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {/* Agent header */}
      {activeAgent && (
        <div className="text-center mb-4">
          <span className="inline-block px-3 py-1 rounded-full bg-gray-800/50 text-xs text-gray-400">
            {activeAgent.name} &middot; {activeAgent.model}
          </span>
        </div>
      )}

      {/* Empty state */}
      {messages.length === 0 && !streaming && (
        <div className="text-center text-gray-500 text-sm mt-12">
          <p>メッセージを送信してエージェントと対話を開始</p>
        </div>
      )}

      {/* Messages */}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Streaming */}
      {streaming && <StreamingBubble content={streaming.content} />}

      <div ref={bottomRef} />
    </div>
  );
}
