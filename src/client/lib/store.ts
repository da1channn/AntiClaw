"use client";
// =============================================================================
// AntiClaw Client State Management (Zustand)
// =============================================================================

import { create } from "zustand";
import type {
  Agent,
  AgentMessage,
  AgentRole,
  AntigravityIDEState,
  CommitResult,
  GitStatus,
  Session,
  TeamPipeline,
  WSClientMessage,
  WSServerMessage,
} from "../../shared/types";

interface StreamingMessage {
  agentId: string;
  messageId: string;
  content: string;
}

type ViewMode = "agents" | "ide-monitor" | "code-editor" | "commit-bridge";

interface AppState {
  // Connection
  connected: boolean;
  ws: WebSocket | null;

  // Session
  session: Session | null;
  activeAgentId: string | null;

  // Antigravity IDE state
  ideState: AntigravityIDEState | null;

  // Streaming
  streamingMessages: Map<string, StreamingMessage>;

  // Pipeline & Git (Bed-to-Commit Bridge)
  activePipeline: TeamPipeline | null;
  pipelineStageStreams: Map<string, string>;
  gitStatus: GitStatus | null;
  lastCommitResult: CommitResult | null;
  diffPreview: string | null;

  // Error state (visible to UI)
  lastError: string | null;
  lastErrorAt: number | null;

  // UI
  sidebarOpen: boolean;
  agentPanelOpen: boolean;
  viewMode: ViewMode;

  // Actions
  connect: () => void;
  disconnect: () => void;
  sendMessage: (agentId: string, content: string) => void;
  createAgent: (role: AgentRole, model?: string) => void;
  stopAgent: (agentId: string) => void;
  deleteAgent: (agentId: string) => void;
  setActiveAgent: (agentId: string | null) => void;
  toggleSidebar: () => void;
  toggleAgentPanel: () => void;
  setViewMode: (mode: ViewMode) => void;

  // IDE actions
  ideSendMessage: (content: string) => void;
  ideStopGeneration: () => void;
  ideRequestState: () => void;

  // Pipeline actions
  startPipeline: (task: string, model?: string) => void;
  cancelPipeline: (pipelineId: string) => void;
  approveCommit: (pipelineId: string, approvalToken: string, message?: string, push?: boolean) => void;
  rejectCommit: (pipelineId: string) => void;
  requestGitStatus: () => void;
  requestDiff: (pipelineId: string) => void;

  // Error actions
  clearError: () => void;
}

const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
    : "";

// Reconnect state (outside store to avoid triggering renders)
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function getReconnectDelay(): number {
  const base = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000); // Max 30s
  const jitter = Math.random() * 1000;
  return base + jitter;
}

/** Request notification permission once. */
function requestNotificationPermission(): void {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendNotification(title: string, body: string): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (document.hasFocus()) return; // Don't notify if app is focused
  new Notification(title, { body, icon: "/icon-192.svg" });
}

/** Safely send a message over WebSocket. No-op if not connected. */
function safeSend(get: () => AppState, msg: WSClientMessage): void {
  const ws = get().ws;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      console.warn("[WS] Send failed, connection may be closing");
    }
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  connected: false,
  ws: null,
  session: null,
  activeAgentId: null,
  ideState: null,
  streamingMessages: new Map(),
  activePipeline: null,
  pipelineStageStreams: new Map(),
  gitStatus: null,
  lastCommitResult: null,
  diffPreview: null,
  lastError: null,
  lastErrorAt: null,
  sidebarOpen: false,
  agentPanelOpen: false,
  viewMode: "agents",

  connect: () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    // Prevent duplicate connections
    const existing = get().ws;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      reconnectAttempt = 0;
      set({ connected: true, ws });
      requestNotificationPermission();

      // Start heartbeat (ping every 25s to keep connection alive through NAT/firewalls)
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "git_status_request" })); } catch { /* ignore */ }
        }
      }, 25000);

      // Listen for online event to trigger immediate reconnect
      window.addEventListener("online", () => {
        if (!get().connected) get().connect();
      }, { once: true });
    };

    ws.onerror = () => {
      // Error followed by close — handled in onclose
      console.warn("[WS] Connection error");
    };

    ws.onclose = () => {
      set({ connected: false, ws: null });
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      // Exponential backoff reconnect with jitter
      const delay = getReconnectDelay();
      reconnectAttempt++;
      reconnectTimer = setTimeout(() => get().connect(), delay);
    };

    ws.onmessage = (event) => {
      let msg: WSServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.warn("[WS] Failed to parse message:", event.data);
        return;
      }
      const state = get();

      switch (msg.type) {
        case "session_sync":
          set({
            session: msg.session,
            activeAgentId: state.activeAgentId || msg.session.agents[0]?.id || null,
          });
          break;

        case "agent_created":
          if (state.session) {
            set({
              session: {
                ...state.session,
                agents: [...state.session.agents, msg.agent],
              },
              activeAgentId: msg.agent.id,
            });
          }
          break;

        case "agent_updated":
          if (state.session) {
            set({
              session: {
                ...state.session,
                agents: state.session.agents.map((a) =>
                  a.id === msg.agent.id ? msg.agent : a
                ),
              },
            });
          }
          break;

        case "agent_deleted":
          if (state.session) {
            const agents = state.session.agents.filter((a) => a.id !== msg.agentId);
            set({
              session: { ...state.session, agents },
              activeAgentId:
                state.activeAgentId === msg.agentId
                  ? agents[0]?.id || null
                  : state.activeAgentId,
            });
          }
          break;

        case "message": {
          if (state.session) {
            const msgs = [...state.session.messages, msg.message];
            set({
              session: {
                ...state.session,
                messages: msgs.length > 500 ? msgs.slice(-500) : msgs,
              },
            });
          }
          break;
        }

        case "message_stream": {
          const streaming = new Map(state.streamingMessages);
          const existing = streaming.get(msg.messageId);
          streaming.set(msg.messageId, {
            agentId: msg.agentId,
            messageId: msg.messageId,
            content: (existing?.content || "") + msg.chunk,
          });
          set({ streamingMessages: streaming });
          break;
        }

        case "message_stream_end": {
          const streaming = new Map(state.streamingMessages);
          streaming.delete(msg.messageId);
          set({ streamingMessages: streaming });
          break;
        }

        case "ide_state":
          set({ ideState: msg.state });
          break;

        case "pipeline_update":
          set({ activePipeline: msg.pipeline });
          break;

        case "pipeline_stage_stream": {
          const streams = new Map(state.pipelineStageStreams);
          const existing = streams.get(msg.stageId) || "";
          streams.set(msg.stageId, existing + msg.chunk);
          set({ pipelineStageStreams: streams });
          break;
        }

        case "commit_ready":
          set({ activePipeline: msg.pipeline, diffPreview: msg.pipeline.diff || null });
          sendNotification("AntiClaw", "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3\u5B8C\u4E86 - \u30B3\u30DF\u30C3\u30C8\u627F\u8A8D\u5F85\u3061");
          break;

        case "commit_result":
          set({ lastCommitResult: msg.result });
          sendNotification("AntiClaw", `\u30B3\u30DF\u30C3\u30C8\u5B8C\u4E86: ${msg.result.hash.slice(0, 8)}`);
          break;

        case "diff_response":
          set({ diffPreview: msg.diff });
          break;

        case "git_status":
          set({ gitStatus: msg.status });
          break;

        case "error":
          console.error("Server error:", msg.error);
          set({ lastError: msg.error, lastErrorAt: Date.now() });
          break;
      }
    };
  },

  disconnect: () => {
    get().ws?.close();
    set({ connected: false, ws: null });
  },

  sendMessage: (agentId, content) => {
    safeSend(get, { type: "send_message", agentId, content });
  },

  createAgent: (role, model) => {
    safeSend(get, { type: "create_agent", role, model });
  },

  stopAgent: (agentId) => {
    safeSend(get, { type: "stop_agent", agentId });
  },

  deleteAgent: (agentId) => {
    safeSend(get, { type: "delete_agent", agentId });
  },

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleAgentPanel: () => set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),

  // Antigravity IDE actions
  ideSendMessage: (content) => {
    safeSend(get, { type: "ide_send_message", content });
  },

  ideStopGeneration: () => {
    safeSend(get, { type: "ide_stop_generation" });
  },

  ideRequestState: () => {
    safeSend(get, { type: "ide_request_state" });
  },

  // Pipeline actions (Bed-to-Commit Bridge)
  startPipeline: (task, model) => {
    set({ activePipeline: null, pipelineStageStreams: new Map(), lastCommitResult: null, diffPreview: null });
    safeSend(get, { type: "pipeline_start", task, model });
  },

  cancelPipeline: (pipelineId) => {
    safeSend(get, { type: "pipeline_cancel", pipelineId });
  },

  approveCommit: (pipelineId, approvalToken, message, push) => {
    safeSend(get, { type: "commit_approve", pipelineId, approvalToken, message, push });
  },

  rejectCommit: (pipelineId) => {
    safeSend(get, { type: "commit_reject", pipelineId });
  },

  requestGitStatus: () => {
    safeSend(get, { type: "git_status_request" });
  },

  requestDiff: (pipelineId) => {
    safeSend(get, { type: "diff_request", pipelineId });
  },

  clearError: () => set({ lastError: null, lastErrorAt: null }),
}));
