// =============================================================================
// AntiClaw Shared Types
// =============================================================================

// --- Authentication ---

export interface CloudflareJWTPayload {
  aud: string[];
  email: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
  identity_nonce: string;
  country?: string;
}

export interface AuthenticatedUser {
  email: string;
  name?: string;
  sub: string;
  groups?: string[];
}

// --- Agent System ---

export type AgentStatus = "idle" | "planning" | "executing" | "reviewing" | "error" | "completed";

export type AgentRole =
  | "architect"    // Plans & designs
  | "frontend"     // Frontend code
  | "backend"      // Backend code
  | "tester"       // Tests & QA
  | "reviewer"     // Code review
  | "devops"       // Infrastructure
  | "general";     // General purpose

export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  status: AgentStatus;
  currentTask?: string;
  model: string;
  createdAt: number;
}

export interface AgentMessage {
  id: string;
  agentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  artifacts?: Artifact[];
}

export interface Artifact {
  id: string;
  type: "code" | "plan" | "file" | "screenshot" | "diff";
  title: string;
  content: string;
  language?: string;
  filePath?: string;
}

// --- Session ---

export interface Session {
  id: string;
  user: AuthenticatedUser;
  agents: Agent[];
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
  projectName?: string;
  workspacePath?: string;
}

// --- WebSocket Messages ---

export type WSClientMessage =
  | { type: "send_message"; agentId: string; content: string }
  | { type: "create_agent"; role: AgentRole; model?: string }
  | { type: "stop_agent"; agentId: string }
  | { type: "delete_agent"; agentId: string };

export type WSServerMessage =
  | { type: "agent_created"; agent: Agent }
  | { type: "agent_updated"; agent: Agent }
  | { type: "agent_deleted"; agentId: string }
  | { type: "message"; message: AgentMessage }
  | { type: "message_stream"; agentId: string; chunk: string; messageId: string }
  | { type: "message_stream_end"; agentId: string; messageId: string }
  | { type: "error"; error: string; agentId?: string }
  | { type: "session_sync"; session: Session };

// --- API ---

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
