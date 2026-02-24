"use client";
// =============================================================================
// AntiClaw Client State Management (Zustand)
// =============================================================================

import { create } from "zustand";
import type {
  Agent,
  AgentMessage,
  AgentRole,
  Session,
  WSClientMessage,
  WSServerMessage,
} from "../../shared/types";

interface StreamingMessage {
  agentId: string;
  messageId: string;
  content: string;
}

interface AppState {
  // Connection
  connected: boolean;
  ws: WebSocket | null;

  // Session
  session: Session | null;
  activeAgentId: string | null;

  // Streaming
  streamingMessages: Map<string, StreamingMessage>;

  // UI
  sidebarOpen: boolean;
  agentPanelOpen: boolean;

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
  streamingMessages: new Map(),
  sidebarOpen: false,
  agentPanelOpen: false,

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
}));
