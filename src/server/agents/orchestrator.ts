// =============================================================================
// Agent Orchestrator
// =============================================================================
// Manages multiple AI agents per session, routes messages, and handles
// the lifecycle of agent instances (create, execute, stop, delete).

import { v4 as uuidv4 } from "uuid";
import { GeminiRunner, StreamChunk } from "./gemini-runner.js";
import type {
  Agent,
  AgentMessage,
  AgentRole,
  AgentStatus,
  Artifact,
  Session,
  AuthenticatedUser,
} from "../../shared/types.js";

const MAX_CONCURRENT_AGENTS = parseInt(process.env.MAX_CONCURRENT_AGENTS || "4", 10);
const ALLOWED_MODELS = (process.env.ALLOWED_MODELS || "gemini-3-pro,gemini-3-flash,gemini-2.5-pro").split(",").map((m) => m.trim());
const VALID_ROLES = new Set<string>(["architect", "frontend", "backend", "tester", "reviewer", "devops", "general"]);
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || "86400000", 10); // 24h
const MAX_MESSAGES_PER_SESSION = 200;

interface AgentInstance {
  agent: Agent;
  runner: GeminiRunner;
}

export class AgentOrchestrator {
  private sessions = new Map<string, Session>();
  private agentInstances = new Map<string, AgentInstance>();

  // Callbacks for WebSocket communication
  public onAgentUpdate?: (sessionId: string, agent: Agent) => void;
  public onMessage?: (sessionId: string, message: AgentMessage) => void;
  public onStreamChunk?: (sessionId: string, agentId: string, chunk: string, messageId: string) => void;
  public onStreamEnd?: (sessionId: string, agentId: string, messageId: string) => void;
  public onError?: (sessionId: string, error: string, agentId?: string) => void;

  /**
   * Create or retrieve a session for a user.
   */
  getOrCreateSession(user: AuthenticatedUser): Session {
    // Find existing session for this user
    for (const session of this.sessions.values()) {
      if (session.user.email === user.email) {
        return session;
      }
    }

    const session: Session = {
      id: uuidv4(),
      user,
      agents: [],
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Remove stale sessions (no activity within SESSION_TTL_MS).
   * Should be called periodically from the server.
   */
  cleanupStaleSessions(): number {
    const cutoff = Date.now() - SESSION_TTL_MS;
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (session.updatedAt < cutoff) {
        // Stop and remove all agents in this session
        for (const agent of session.agents) {
          const instance = this.agentInstances.get(agent.id);
          if (instance) {
            instance.runner.stop();
            instance.runner.removeAllListeners();
            this.agentInstances.delete(agent.id);
          }
        }
        this.sessions.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Create a new agent in the session.
   */
  createAgent(sessionId: string, role: AgentRole, model?: string): Agent {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // Validate role
    if (!VALID_ROLES.has(role)) {
      throw new Error(`Invalid agent role: ${role}`);
    }

    // Validate model if provided
    if (model && !ALLOWED_MODELS.includes(model)) {
      throw new Error(`Model not allowed: ${model}. Allowed: ${ALLOWED_MODELS.join(", ")}`);
    }

    const activeAgents = session.agents.filter(
      (a) => a.status !== "completed" && a.status !== "error"
    );
    if (activeAgents.length >= MAX_CONCURRENT_AGENTS) {
      throw new Error(`Maximum ${MAX_CONCURRENT_AGENTS} concurrent agents allowed`);
    }

    const ROLE_NAMES: Record<AgentRole, string> = {
      architect: "Architect",
      frontend: "Frontend Dev",
      backend: "Backend Dev",
      tester: "QA Tester",
      reviewer: "Code Reviewer",
      devops: "DevOps Engineer",
      general: "Assistant",
    };

    const agent: Agent = {
      id: uuidv4(),
      role,
      name: ROLE_NAMES[role],
      status: "idle",
      model: model || process.env.GEMINI_MODEL || "gemini-3-pro",
      createdAt: Date.now(),
    };

    const runner = new GeminiRunner(role, agent.model);

    session.agents.push(agent);
    this.agentInstances.set(agent.id, { agent, runner });

    session.updatedAt = Date.now();
    this.onAgentUpdate?.(sessionId, agent);

    return agent;
  }

  /**
   * Send a message to a specific agent and stream the response.
   */
  async sendMessage(sessionId: string, agentId: string, content: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const instance = this.agentInstances.get(agentId);
    if (!session || !instance) throw new Error("Session or agent not found");

    // Record user message
    const userMessage: AgentMessage = {
      id: uuidv4(),
      agentId,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    session.messages.push(userMessage);
    // Cap message history to prevent unbounded memory growth
    if (session.messages.length > MAX_MESSAGES_PER_SESSION) {
      session.messages = session.messages.slice(-MAX_MESSAGES_PER_SESSION);
    }
    this.onMessage?.(sessionId, userMessage);

    // Update agent status
    this.updateAgentStatus(sessionId, agentId, "executing", content);

    const responseMessageId = uuidv4();

    // Set up streaming
    let fullResponse = "";
    instance.runner.on("stream", (chunk: StreamChunk) => {
      if (chunk.type === "text") {
        fullResponse += chunk.content;
        this.onStreamChunk?.(sessionId, agentId, chunk.content, responseMessageId);
      }
    });

    try {
      const response = await instance.runner.execute(content);

      // Parse artifacts from response
      const artifacts = this.extractArtifacts(response);

      // Record assistant message
      const assistantMessage: AgentMessage = {
        id: responseMessageId,
        agentId,
        role: "assistant",
        content: response,
        timestamp: Date.now(),
        artifacts,
      };
      session.messages.push(assistantMessage);

      this.onStreamEnd?.(sessionId, agentId, responseMessageId);
      this.onMessage?.(sessionId, assistantMessage);
      this.updateAgentStatus(sessionId, agentId, "idle");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      this.updateAgentStatus(sessionId, agentId, "error");
      this.onError?.(sessionId, errorMsg, agentId);
    } finally {
      instance.runner.removeAllListeners("stream");
    }

    session.updatedAt = Date.now();
  }

  /**
   * Stop a running agent.
   */
  stopAgent(sessionId: string, agentId: string): void {
    const instance = this.agentInstances.get(agentId);
    if (instance) {
      instance.runner.stop();
      this.updateAgentStatus(sessionId, agentId, "idle");
    }
  }

  /**
   * Delete an agent from the session.
   */
  deleteAgent(sessionId: string, agentId: string): void {
    const session = this.sessions.get(sessionId);
    const instance = this.agentInstances.get(agentId);

    if (instance) {
      instance.runner.stop();
      instance.runner.removeAllListeners();
      this.agentInstances.delete(agentId);
    }

    if (session) {
      session.agents = session.agents.filter((a) => a.id !== agentId);
      session.updatedAt = Date.now();
    }
  }

  private updateAgentStatus(
    sessionId: string,
    agentId: string,
    status: AgentStatus,
    currentTask?: string
  ): void {
    const instance = this.agentInstances.get(agentId);
    if (instance) {
      instance.agent.status = status;
      instance.agent.currentTask = currentTask;
      this.onAgentUpdate?.(sessionId, instance.agent);
    }
  }

  /**
   * Extract code blocks and structured artifacts from agent responses.
   */
  private extractArtifacts(content: string): Artifact[] {
    const artifacts: Artifact[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;

    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const language = match[1] || "text";
      const code = match[2].trim();

      // Try to detect file paths from comments
      const filePathMatch = code.match(/^\/\/\s*(?:file|path):\s*(.+)/m) ||
        code.match(/^#\s*(?:file|path):\s*(.+)/m);

      artifacts.push({
        id: uuidv4(),
        type: "code",
        title: filePathMatch ? filePathMatch[1].trim() : `${language} snippet`,
        content: code,
        language,
        filePath: filePathMatch ? filePathMatch[1].trim() : undefined,
      });
    }

    return artifacts;
  }
}
