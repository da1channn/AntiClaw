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
}

// --- Antigravity IDE State (CDP Bridge) ---

export interface AntigravityChatMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
  timestamp: number;
}

export interface AntigravityIDEState {
  connected: boolean;
  activeModel: string | null;
  activeMode: string | null;      // "fast" | "planning" | "agent"
  messages: AntigravityChatMessage[];
  isGenerating: boolean;
  agentCount: number;
}

// --- WebSocket Messages (Antigravity IDE) ---
// Moved to "WebSocket Messages (Bed-to-Commit Bridge)" section below with extended types

// --- Team Agent Pipeline (Bed-to-Commit Bridge) ---

export type PipelineStageStatus = "pending" | "running" | "completed" | "error" | "skipped";

export interface PipelineStage {
  id: string;
  role: AgentRole;
  status: PipelineStageStatus;
  agentId?: string;
  input?: string;
  output?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export type PipelineStatus = "idle" | "planning" | "executing" | "reviewing" | "awaiting_approval" | "committing" | "completed" | "error";

export interface TeamPipeline {
  id: string;
  sessionId: string;
  task: string;
  status: PipelineStatus;
  stages: PipelineStage[];
  diff?: string;
  commitRequest?: CommitRequest;
  commitResult?: CommitResult;
  createdAt: number;
  updatedAt: number;
}

export interface CommitRequest {
  pipelineId: string;
  message: string;
  branch: string;
  files: CommitFile[];
  approvalToken: string;
  expiresAt: number;
}

export interface CommitFile {
  path: string;
  action: "add" | "modify" | "delete";
  content?: string;
  diff?: string;
}

export interface CommitResult {
  hash: string;
  branch: string;
  message: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  timestamp: number;
  pushed: boolean;
}

export interface GitStatus {
  branch: string;
  clean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

// --- WebSocket Messages (Bed-to-Commit Bridge) ---

export type WSClientMessage =
  | { type: "send_message"; agentId: string; content: string }
  | { type: "create_agent"; role: AgentRole; model?: string }
  | { type: "stop_agent"; agentId: string }
  | { type: "delete_agent"; agentId: string }
  | { type: "ide_send_message"; content: string }
  | { type: "ide_stop_generation" }
  | { type: "ide_request_state" }
  | { type: "pipeline_start"; task: string; model?: string }
  | { type: "pipeline_cancel"; pipelineId: string }
  | { type: "commit_approve"; pipelineId: string; approvalToken: string; message?: string; push?: boolean }
  | { type: "commit_reject"; pipelineId: string }
  | { type: "git_status_request" }
  | { type: "diff_request"; pipelineId: string };

export type WSServerMessage =
  | { type: "agent_created"; agent: Agent }
  | { type: "agent_updated"; agent: Agent }
  | { type: "agent_deleted"; agentId: string }
  | { type: "message"; message: AgentMessage }
  | { type: "message_stream"; agentId: string; chunk: string; messageId: string }
  | { type: "message_stream_end"; agentId: string; messageId: string }
  | { type: "error"; error: string; agentId?: string }
  | { type: "session_sync"; session: Session }
  | { type: "ide_state"; state: AntigravityIDEState }
  | { type: "pipeline_update"; pipeline: TeamPipeline }
  | { type: "pipeline_stage_stream"; pipelineId: string; stageId: string; chunk: string }
  | { type: "commit_ready"; pipeline: TeamPipeline }
  | { type: "commit_result"; pipelineId: string; result: CommitResult }
  | { type: "git_status"; status: GitStatus }
  | { type: "diff_response"; pipelineId: string; diff: string };

// --- API ---

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
