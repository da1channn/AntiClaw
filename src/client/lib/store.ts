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
}

const WS_URL =
  typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
    : "";

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
  sidebarOpen: false,
  agentPanelOpen: false,
  viewMode: "agents",

  connect: () => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      set({ connected: true, ws });
    };

    ws.onclose = () => {
      set({ connected: false, ws: null });
      // Auto-reconnect after 3s
      setTimeout(() => get().connect(), 3000);
    };

    ws.onmessage = (event) => {
      const msg: WSServerMessage = JSON.parse(event.data);
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

        case "message":
          if (state.session) {
            set({
              session: {
                ...state.session,
                messages: [...state.session.messages, msg.message],
              },
            });
          }
          break;

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
          set({ activePipeline: msg.pipeline });
          break;

        case "commit_result":
          set({ lastCommitResult: msg.result });
          break;

        case "git_status":
          set({ gitStatus: msg.status });
          break;

        case "error":
          console.error("Server error:", msg.error);
          break;
      }
    };
  },

  disconnect: () => {
    get().ws?.close();
    set({ connected: false, ws: null });
  },

  sendMessage: (agentId, content) => {
    const msg: WSClientMessage = { type: "send_message", agentId, content };
    get().ws?.send(JSON.stringify(msg));
  },

  createAgent: (role, model) => {
    const msg: WSClientMessage = { type: "create_agent", role, model };
    get().ws?.send(JSON.stringify(msg));
  },

  stopAgent: (agentId) => {
    const msg: WSClientMessage = { type: "stop_agent", agentId };
    get().ws?.send(JSON.stringify(msg));
  },

  deleteAgent: (agentId) => {
    const msg: WSClientMessage = { type: "delete_agent", agentId };
    get().ws?.send(JSON.stringify(msg));
  },

  setActiveAgent: (agentId) => set({ activeAgentId: agentId }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleAgentPanel: () => set((s) => ({ agentPanelOpen: !s.agentPanelOpen })),
  setViewMode: (mode) => set({ viewMode: mode }),

  // Antigravity IDE actions
  ideSendMessage: (content) => {
    const msg: WSClientMessage = { type: "ide_send_message", content };
    get().ws?.send(JSON.stringify(msg));
  },

  ideStopGeneration: () => {
    const msg: WSClientMessage = { type: "ide_stop_generation" };
    get().ws?.send(JSON.stringify(msg));
  },

  ideRequestState: () => {
    const msg: WSClientMessage = { type: "ide_request_state" };
    get().ws?.send(JSON.stringify(msg));
  },

  // Pipeline actions (Bed-to-Commit Bridge)
  startPipeline: (task, model) => {
    const msg: WSClientMessage = { type: "pipeline_start", task, model };
    set({ activePipeline: null, pipelineStageStreams: new Map(), lastCommitResult: null });
    get().ws?.send(JSON.stringify(msg));
  },

  cancelPipeline: (pipelineId) => {
    const msg: WSClientMessage = { type: "pipeline_cancel", pipelineId };
    get().ws?.send(JSON.stringify(msg));
  },

  approveCommit: (pipelineId, approvalToken, message, push) => {
    const msg: WSClientMessage = { type: "commit_approve", pipelineId, approvalToken, message, push };
    get().ws?.send(JSON.stringify(msg));
  },

  rejectCommit: (pipelineId) => {
    const msg: WSClientMessage = { type: "commit_reject", pipelineId };
    get().ws?.send(JSON.stringify(msg));
  },

  requestGitStatus: () => {
    const msg: WSClientMessage = { type: "git_status_request" };
    get().ws?.send(JSON.stringify(msg));
  },
}));
