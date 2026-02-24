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
import type { WSClientMessage, WSServerMessage, AuthenticatedUser } from "../shared/types.js";

const PORT = parseInt(process.env.PORT || "3000", 10);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// --- Middleware ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// --- Orchestrator ---
const orchestrator = new AgentOrchestrator();

// Track WebSocket connections per session
const wsConnections = new Map<string, Set<WebSocket>>();

function broadcastToSession(sessionId: string, message: WSServerMessage): void {
  const connections = wsConnections.get(sessionId);
  if (!connections) return;
  const data = JSON.stringify(message);
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
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

// --- REST API ---

// Health check (no auth required)
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "anticlaw", version: "1.0.0" });
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
      const msg: WSClientMessage = JSON.parse(data.toString());

      switch (msg.type) {
        case "send_message":
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
    }
  });
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`AntiClaw server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`SSO bypass: ${process.env.CF_POLICY_BYPASS === "true" ? "ENABLED (dev)" : "DISABLED"}`);
});
