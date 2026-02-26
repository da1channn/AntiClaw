// =============================================================================
// AntiClaw Server - Main Entry Point
// =============================================================================
// Express + WebSocket server providing the API gateway for agent management
// and real-time communication. Protected by Cloudflare Access SSO.

import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import helmet from "helmet";
import { requireAuth, verifyCloudflareToken } from "./auth/cloudflare-access.js";
import { AgentOrchestrator } from "./agents/orchestrator.js";
import { TeamOrchestrator } from "./agents/team-orchestrator.js";
import { GitBridge } from "./git/git-bridge.js";
import { CDPBridge } from "./antigravity/cdp-bridge.js";
import { createCodeServerProxy, checkCodeServerHealth } from "./antigravity/code-server-proxy.js";
import type { WSClientMessage, WSServerMessage, AuthenticatedUser, TeamPipeline } from "../shared/types.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 }); // 64KB max

// --- Safety: guard CF_POLICY_BYPASS in production ---
if (process.env.CF_POLICY_BYPASS === "true" && process.env.NODE_ENV === "production") {
  console.error("FATAL: CF_POLICY_BYPASS=true is not allowed in production. Exiting.");
  process.exit(1);
}

// --- Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      workerSrc: ["'self'"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: "64kb" }));

// --- Orchestrator ---
const orchestrator = new AgentOrchestrator();
const teamOrchestrator = new TeamOrchestrator();
const gitBridge = new GitBridge();

// Track WebSocket connections per session
const wsConnections = new Map<string, Set<WebSocket>>();

// Track active pipelines per session (for commit approval flow)
const activePipelines = new Map<string, TeamPipeline>();

// Per-session WebSocket message rate limiting (max 60 messages/minute)
const wsRateLimits = new Map<string, number[]>();
const WS_RATE_LIMIT = 60;
const WS_RATE_WINDOW_MS = 60_000;

// Periodic cleanup of stale pipelines (older than 1 hour) and sessions
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [id, pipeline] of activePipelines) {
    if (pipeline.updatedAt < cutoff) {
      teamOrchestrator.cancelPipeline(id);
      activePipelines.delete(id);
    }
  }
  const cleaned = orchestrator.cleanupStaleSessions();
  if (cleaned > 0) console.log(`[CLEANUP] Removed ${cleaned} stale session(s)`);
}, 600_000); // Every 10 min

// --- CDP Bridge (Antigravity IDE connection) ---
const cdpBridge = new CDPBridge();

// Auto-connect to Antigravity IDE
cdpBridge.connect().then(() => {
  console.log("Connected to Antigravity IDE via CDP");
}).catch((err) => {
  console.warn(`CDP bridge not available (start Antigravity with --remote-debugging-port=9222): ${err.message}`);
});

// Broadcast IDE state changes to all connected clients
cdpBridge.on("state_updated", (state) => {
  const msg: WSServerMessage = { type: "ide_state", state };
  const data = JSON.stringify(msg);
  for (const connectionSet of wsConnections.values()) {
    for (const ws of connectionSet) {
      safeSend(ws, data);
    }
  }
});

function safeSend(ws: WebSocket, data: string): void {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  } catch {
    // Connection may have closed between readyState check and send
  }
}

function broadcastToSession(sessionId: string, message: WSServerMessage): void {
  const connections = wsConnections.get(sessionId);
  if (!connections) return;
  const data = JSON.stringify(message);
  for (const ws of connections) {
    safeSend(ws, data);
  }
}

// Wire orchestrator events to WebSocket broadcasts
orchestrator.onAgentUpdate = (sessionId, agent) => {
  broadcastToSession(sessionId, { type: "agent_updated", agent });
};

orchestrator.onMessage = (sessionId, message) => {
  broadcastToSession(sessionId, { type: "message", message });
};

orchestrator.onStreamChunk = (sessionId, agentId, chunk, messageId) => {
  broadcastToSession(sessionId, {
    type: "message_stream",
    agentId,
    chunk,
    messageId,
  });
};

orchestrator.onStreamEnd = (sessionId, agentId, messageId) => {
  broadcastToSession(sessionId, {
    type: "message_stream_end",
    agentId,
    messageId,
  });
};

orchestrator.onError = (sessionId, error, agentId) => {
  broadcastToSession(sessionId, { type: "error", error, agentId });
};

// Wire team orchestrator events
teamOrchestrator.onPipelineUpdate = (sessionId, pipeline) => {
  activePipelines.set(pipeline.id, pipeline);
  broadcastToSession(sessionId, { type: "pipeline_update", pipeline });
};

teamOrchestrator.onStageStream = (sessionId, pipelineId, stageId, chunk) => {
  broadcastToSession(sessionId, { type: "pipeline_stage_stream", pipelineId, stageId, chunk });
};

teamOrchestrator.onPipelineComplete = async (sessionId, pipeline) => {
  // Generate approval token and commit request
  const { token, expiresAt } = gitBridge.generateApprovalToken(pipeline.id);
  const files = teamOrchestrator.collectFileChanges(pipeline);
  const message = teamOrchestrator.extractCommitMessage(pipeline);

  pipeline.commitRequest = {
    pipelineId: pipeline.id,
    message,
    branch: "",
    files: files.map((f) => ({ path: f.path, action: "modify" as const, content: f.content })),
    approvalToken: token,
    expiresAt,
  };

  // Write files to disk so we can generate a real diff preview
  try {
    await gitBridge.writeFilesForPreview(pipeline.commitRequest.files);
    const diff = await gitBridge.getPreviewDiff(pipeline.commitRequest.files);
    pipeline.diff = diff;
  } catch {
    pipeline.diff = "(diff preview unavailable)";
  }

  // Get current branch for commit request
  try {
    const status = await gitBridge.getStatus();
    pipeline.commitRequest.branch = status.branch;
  } catch {
    pipeline.commitRequest.branch = "main";
  }

  activePipelines.set(pipeline.id, pipeline);
  broadcastToSession(sessionId, { type: "commit_ready", pipeline });
};

teamOrchestrator.onError = (sessionId, pipelineId, error) => {
  broadcastToSession(sessionId, { type: "error", error });
};

// --- REST API ---

// Health check (no auth required)
app.get("/api/health", async (_req, res) => {
  const codeServerUp = await checkCodeServerHealth();
  res.json({
    ok: true,
    service: "anticlaw",
    version: "1.0.0",
    integrations: {
      antigravityIDE: cdpBridge.getState().connected,
      codeServer: codeServerUp,
    },
  });
});

// All other API routes require authentication
app.use("/api", requireAuth);

// Get or create session
app.get("/api/session", (req, res) => {
  const session = orchestrator.getOrCreateSession(req.user!);
  res.json({ ok: true, data: session });
});

// Create agent
app.post("/api/agents", (req, res) => {
  try {
    const session = orchestrator.getOrCreateSession(req.user!);
    const { role, model } = req.body;
    const agent = orchestrator.createAgent(session.id, role, model);
    res.json({ ok: true, data: agent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create agent";
    res.status(400).json({ ok: false, error: msg });
  }
});

// Delete agent
app.delete("/api/agents/:agentId", (req, res) => {
  try {
    const session = orchestrator.getOrCreateSession(req.user!);
    orchestrator.deleteAgent(session.id, req.params.agentId);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete agent";
    res.status(400).json({ ok: false, error: msg });
  }
});

// --- Antigravity IDE Bridge API ---

// Get current IDE state
app.get("/api/ide/state", (_req, res) => {
  res.json({ ok: true, data: cdpBridge.getState() });
});

// Send message to IDE chat
app.post("/api/ide/message", async (req, res) => {
  try {
    await cdpBridge.sendChatMessage(req.body.content);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send IDE message";
    res.status(400).json({ ok: false, error: msg });
  }
});

// Stop IDE generation
app.post("/api/ide/stop", async (_req, res) => {
  try {
    await cdpBridge.stopGeneration();
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to stop generation";
    res.status(400).json({ ok: false, error: msg });
  }
});

// --- Bed-to-Commit Bridge API ---

// Get git status
app.get("/api/git/status", async (_req, res) => {
  try {
    const status = await gitBridge.getStatus();
    res.json({ ok: true, data: status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get git status";
    res.status(500).json({ ok: false, error: msg });
  }
});

// Start a team pipeline
app.post("/api/pipeline/start", (req, res) => {
  try {
    const session = orchestrator.getOrCreateSession(req.user!);
    const { task, model } = req.body;
    if (!task || typeof task !== "string") {
      res.status(400).json({ ok: false, error: "Task is required" });
      return;
    }
    const pipeline = teamOrchestrator.startPipeline(session.id, task, model);
    res.json({ ok: true, data: pipeline });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start pipeline";
    res.status(400).json({ ok: false, error: msg });
  }
});

// Cancel a pipeline
app.post("/api/pipeline/:pipelineId/cancel", (_req, res) => {
  try {
    teamOrchestrator.cancelPipeline(_req.params.pipelineId);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to cancel pipeline";
    res.status(400).json({ ok: false, error: msg });
  }
});

// Approve and commit
app.post("/api/pipeline/:pipelineId/commit", async (req, res) => {
  try {
    const pipeline = activePipelines.get(req.params.pipelineId);
    if (!pipeline || !pipeline.commitRequest) {
      res.status(404).json({ ok: false, error: "Pipeline or commit request not found" });
      return;
    }

    const { approvalToken, message, push } = req.body;
    const commitRequest = {
      ...pipeline.commitRequest,
      approvalToken,
      message: message || pipeline.commitRequest.message,
    };

    const result = await gitBridge.executeCommit(commitRequest, req.user!.email);

    if (push) {
      await gitBridge.push(commitRequest.branch, req.user!.email, pipeline.id);
      result.pushed = true;
    }

    pipeline.commitResult = result;
    pipeline.status = "completed";
    pipeline.updatedAt = Date.now();

    const session = orchestrator.getOrCreateSession(req.user!);
    broadcastToSession(session.id, { type: "commit_result", pipelineId: pipeline.id, result });
    broadcastToSession(session.id, { type: "pipeline_update", pipeline });

    res.json({ ok: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Commit failed";
    res.status(400).json({ ok: false, error: msg });
  }
});

// Get audit log
app.get("/api/git/audit", (_req, res) => {
  res.json({ ok: true, data: gitBridge.getAuditLog() });
});

// --- code-server Proxy ---
// Mount code-server proxy with relaxed CSP (code-server needs its own scripts)
app.use("/code", requireAuth, (_req, res, next) => {
  res.removeHeader("Content-Security-Policy");
  next();
}, createCodeServerProxy());

// --- WebSocket ---

wss.on("connection", async (ws, req) => {
  let user: AuthenticatedUser;

  // Authenticate WebSocket connection
  if (process.env.CF_POLICY_BYPASS === "true") {
    user = { email: "dev@localhost", name: "Development User", sub: "dev-local" };
  } else {
    const token =
      new URL(req.url || "", `http://${req.headers.host}`).searchParams.get("token") ||
      (req.headers.cookie?.match(/CF_Authorization=([^;]+)/)?.[1]);

    if (!token) {
      ws.close(4001, "Authentication required");
      return;
    }

    try {
      const payload = await verifyCloudflareToken(token);
      user = { email: payload.email, sub: payload.sub };
    } catch {
      ws.close(4003, "Invalid token");
      return;
    }
  }

  // Get or create session
  const session = orchestrator.getOrCreateSession(user);

  // Track connection
  if (!wsConnections.has(session.id)) {
    wsConnections.set(session.id, new Set());
  }
  wsConnections.get(session.id)!.add(ws);

  // Send initial session state
  const syncMsg: WSServerMessage = { type: "session_sync", session };
  ws.send(JSON.stringify(syncMsg));

  // Handle incoming messages
  ws.on("message", async (data) => {
    try {
      // Rate limit check
      const now = Date.now();
      const timestamps = wsRateLimits.get(session.id) || [];
      const recent = timestamps.filter((t) => now - t < WS_RATE_WINDOW_MS);
      if (recent.length >= WS_RATE_LIMIT) {
        ws.send(JSON.stringify({ type: "error", error: "Rate limit exceeded. Please slow down." } satisfies WSServerMessage));
        return;
      }
      recent.push(now);
      wsRateLimits.set(session.id, recent);

      const msg: WSClientMessage = JSON.parse(data.toString());

      switch (msg.type) {
        case "send_message":
          if (!msg.agentId || typeof msg.content !== "string" || msg.content.length === 0 || msg.content.length > 10000) {
            throw new Error("Invalid message: agentId required, content must be 1-10000 chars");
          }
          await orchestrator.sendMessage(session.id, msg.agentId, msg.content);
          break;

        case "create_agent":
          orchestrator.createAgent(session.id, msg.role, msg.model);
          break;

        case "stop_agent":
          orchestrator.stopAgent(session.id, msg.agentId);
          break;

        case "delete_agent":
          orchestrator.deleteAgent(session.id, msg.agentId);
          break;

        // Antigravity IDE commands
        case "ide_send_message":
          await cdpBridge.sendChatMessage(msg.content);
          break;

        case "ide_stop_generation":
          await cdpBridge.stopGeneration();
          break;

        case "ide_request_state":
          ws.send(JSON.stringify({ type: "ide_state", state: cdpBridge.getState() } satisfies WSServerMessage));
          break;

        // Bed-to-Commit Bridge commands
        case "pipeline_start":
          if (!msg.task || typeof msg.task !== "string" || msg.task.length === 0 || msg.task.length > 5000) {
            throw new Error("Invalid task: must be 1-5000 chars");
          }
          await teamOrchestrator.startPipeline(session.id, msg.task, msg.model);
          break;

        case "pipeline_cancel":
          teamOrchestrator.cancelPipeline(msg.pipelineId);
          break;

        case "commit_approve": {
          const pipeline = activePipelines.get(msg.pipelineId);
          if (pipeline?.commitRequest) {
            try {
              const commitReq = {
                ...pipeline.commitRequest,
                approvalToken: msg.approvalToken,
                message: msg.message || pipeline.commitRequest.message,
              };
              const result = await gitBridge.executeCommit(commitReq, user.email);
              if (msg.push) {
                await gitBridge.push(commitReq.branch, user.email, pipeline.id);
                result.pushed = true;
              }
              pipeline.commitResult = result;
              pipeline.status = "completed";
              pipeline.updatedAt = Date.now();
              broadcastToSession(session.id, { type: "commit_result", pipelineId: pipeline.id, result });
              broadcastToSession(session.id, { type: "pipeline_update", pipeline });
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : "Commit failed";
              ws.send(JSON.stringify({ type: "error", error: errorMsg } satisfies WSServerMessage));
            }
          }
          break;
        }

        case "commit_reject": {
          const rejectedPipeline = activePipelines.get(msg.pipelineId);
          if (rejectedPipeline) {
            rejectedPipeline.status = "error";
            rejectedPipeline.updatedAt = Date.now();
            activePipelines.delete(msg.pipelineId);
            broadcastToSession(session.id, { type: "pipeline_update", pipeline: rejectedPipeline });
          }
          break;
        }

        case "git_status_request": {
          try {
            const status = await gitBridge.getStatus();
            ws.send(JSON.stringify({ type: "git_status", status } satisfies WSServerMessage));
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Failed to get git status";
            ws.send(JSON.stringify({ type: "error", error: errorMsg } satisfies WSServerMessage));
          }
          break;
        }

        case "diff_request": {
          const diffPipeline = activePipelines.get(msg.pipelineId);
          if (diffPipeline?.diff) {
            ws.send(JSON.stringify({ type: "diff_response", pipelineId: msg.pipelineId, diff: diffPipeline.diff } satisfies WSServerMessage));
          } else if (diffPipeline?.commitRequest) {
            try {
              const diff = await gitBridge.getPreviewDiff(diffPipeline.commitRequest.files);
              ws.send(JSON.stringify({ type: "diff_response", pipelineId: msg.pipelineId, diff } satisfies WSServerMessage));
            } catch {
              ws.send(JSON.stringify({ type: "diff_response", pipelineId: msg.pipelineId, diff: "(diff unavailable)" } satisfies WSServerMessage));
            }
          }
          break;
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      ws.send(JSON.stringify({ type: "error", error: errorMsg } satisfies WSServerMessage));
    }
  });

  ws.on("close", () => {
    wsConnections.get(session.id)?.delete(ws);
    if (wsConnections.get(session.id)?.size === 0) {
      wsConnections.delete(session.id);
      wsRateLimits.delete(session.id);
    }
  });
});

// --- Graceful Shutdown ---
function shutdown(signal: string): void {
  console.log(`\n[SHUTDOWN] ${signal} received. Cleaning up...`);

  // 1. Stop accepting new connections
  wss.close();

  // 2. Close all WebSocket connections
  for (const connectionSet of wsConnections.values()) {
    for (const ws of connectionSet) {
      ws.close(1001, "Server shutting down");
    }
  }
  wsConnections.clear();

  // 3. Cancel all active pipelines
  for (const [id] of activePipelines) {
    teamOrchestrator.cancelPipeline(id);
  }
  activePipelines.clear();

  // 4. Disconnect CDP bridge
  cdpBridge.disconnect();

  // 5. Close HTTP server
  server.close(() => {
    console.log("[SHUTDOWN] Server closed.");
    process.exit(0);
  });

  // Force exit after 5s if cleanup hangs
  setTimeout(() => {
    console.error("[SHUTDOWN] Forced exit after timeout.");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`AntiClaw server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`SSO bypass: ${process.env.CF_POLICY_BYPASS === "true" ? "ENABLED (dev)" : "DISABLED"}`);
  console.log(`code-server proxy: /code -> ${process.env.CODE_SERVER_URL || "http://127.0.0.1:8080"}`);
  console.log(`CDP bridge: ${process.env.CDP_HOST || "127.0.0.1"}:${process.env.CDP_PORT || "9222"}`);
});
