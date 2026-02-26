// =============================================================================
// CDP Bridge - Chrome DevTools Protocol connection to Antigravity IDE
// =============================================================================
// Connects to Antigravity IDE via CDP (--remote-debugging-port=9222) to:
// - Monitor AI agent chat in real-time
// - Send messages to agents
// - Switch models and modes
// - Capture chat state via DOM inspection
//
// Based on community tools: antigravity_phone_chat, AntigravityMobile
// Reference: https://github.com/AvenalJ/AntigravityMobile

import WebSocket from "ws";
import http from "http";
import { EventEmitter } from "events";

const CDP_HOST = process.env.CDP_HOST || "127.0.0.1";
const CDP_PORT = parseInt(process.env.CDP_PORT || "9222", 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "2000", 10);

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
  timestamp: number;
}

export interface AntigravityState {
  connected: boolean;
  activeModel: string | null;
  activeMode: string | null;     // "fast" | "planning" | "agent"
  messages: ChatMessage[];
  isGenerating: boolean;
  agentCount: number;
}

/**
 * Discovers available CDP targets (browser tabs/windows) from Antigravity IDE.
 */
async function discoverTargets(): Promise<Array<{ id: string; title: string; webSocketDebuggerUrl: string }>> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${CDP_HOST}:${CDP_PORT}/json`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const targets = JSON.parse(data);
          resolve(targets);
        } catch (e) {
          reject(new Error(`Failed to parse CDP targets: ${e}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("CDP discovery timeout"));
    });
  });
}

/**
 * Find the Antigravity workbench target (main IDE window).
 */
async function findAntigravityTarget(): Promise<string | null> {
  try {
    const targets = await discoverTargets();
    // Look for the main workbench window
    const workbench = targets.find(
      (t) =>
        t.title.includes("Antigravity") ||
        t.title.includes("workbench") ||
        t.title.includes("Visual Studio Code")
    );
    return workbench?.webSocketDebuggerUrl || targets[0]?.webSocketDebuggerUrl || null;
  } catch {
    return null;
  }
}

export class CDPBridge extends EventEmitter {
  private ws: WebSocket | null = null;
  private cmdId = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pendingCommands = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private state: AntigravityState = {
    connected: false,
    activeModel: null,
    activeMode: null,
    messages: [],
    isGenerating: false,
    agentCount: 0,
  };

  getState(): AntigravityState {
    return { ...this.state };
  }

  /**
   * Connect to Antigravity IDE via CDP.
   * Uses exponential backoff for reconnection attempts.
   */
  async connect(): Promise<void> {
    if (this.destroyed) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }

    const wsUrl = await findAntigravityTarget();
    if (!wsUrl) {
      // Schedule retry with backoff instead of throwing immediately on reconnect
      if (this.reconnectAttempt > 0) {
        this.scheduleReconnect();
        return;
      }
      throw new Error(
        `Cannot connect to Antigravity IDE. Ensure it is running with: antigravity . --remote-debugging-port=${CDP_PORT}`
      );
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.reconnectAttempt = 0; // Reset backoff on successful connection
        this.state.connected = true;
        this.emit("connected");
        this.enableDOMEvents();
        this.startPolling();
        resolve();
      });

      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle command responses
          if (msg.id !== undefined && this.pendingCommands.has(msg.id)) {
            const pending = this.pendingCommands.get(msg.id)!;
            this.pendingCommands.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message));
            } else {
              pending.resolve(msg.result);
            }
          }

          // Handle CDP events
          if (msg.method) {
            this.handleCDPEvent(msg.method, msg.params);
          }
        } catch (err) {
          console.warn("[CDP] Failed to parse message:", err);
        }
      });

      this.ws.on("close", () => {
        this.state.connected = false;
        this.stopPolling();
        this.rejectPendingCommands("CDP connection closed");
        this.emit("disconnected");
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        console.warn("[CDP] WebSocket error:", err.message);
        if (!this.state.connected) reject(err);
        this.emit("error", err);
      });
    });
  }

  /**
   * Schedule a reconnect attempt with exponential backoff (max 60s).
   */
  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 60000);
    const jitter = Math.random() * 2000;
    this.reconnectAttempt++;
    console.log(`[CDP] Reconnecting in ${Math.round((delay + jitter) / 1000)}s (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), delay + jitter);
  }

  /**
   * Reject all pending CDP commands (called on disconnect).
   */
  private rejectPendingCommands(reason: string): void {
    for (const [id, pending] of this.pendingCommands) {
      pending.reject(new Error(reason));
      this.pendingCommands.delete(id);
    }
  }

  /**
   * Send a CDP command and await the response.
   */
  private sendCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("CDP not connected"));
        return;
      }

      const id = ++this.cmdId;
      this.pendingCommands.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));

      // Timeout after 10s
      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }
      }, 10000);
    });
  }

  /**
   * Execute JavaScript in the Antigravity IDE context.
   */
  async evaluate(expression: string): Promise<unknown> {
    const result = await this.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return (result as { result?: { value?: unknown } })?.result?.value;
  }

  /**
   * Enable DOM change notifications.
   */
  private async enableDOMEvents(): Promise<void> {
    await this.sendCommand("Runtime.enable");
    await this.sendCommand("DOM.enable");
  }

  /**
   * Poll the Antigravity chat state at regular intervals.
   */
  private startPolling(): void {
    this.pollTimer = setInterval(() => this.pollChatState(), POLL_INTERVAL_MS);
    // Initial poll
    this.pollChatState();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Read the current chat state from Antigravity's DOM.
   * Extracts messages, active model, generation status.
   */
  private async pollChatState(): Promise<void> {
    try {
      const state = await this.evaluate(`
        (() => {
          // Extract chat messages from the IDE's chat panel
          const chatContainer = document.querySelector(
            '.chat-widget .chat-list-container, ' +
            '[class*="chat-message-list"], ' +
            '.interactive-list'
          );

          const messages = [];
          if (chatContainer) {
            const messageElements = chatContainer.querySelectorAll(
              '.chat-list-item, [class*="chat-message"]'
            );
            messageElements.forEach(el => {
              const isUser = el.classList.contains('user') ||
                el.querySelector('[class*="request"]') !== null;
              const contentEl = el.querySelector(
                '.chat-list-item-body, [class*="message-content"], .rendered-markdown'
              );
              if (contentEl) {
                messages.push({
                  role: isUser ? 'user' : 'assistant',
                  content: contentEl.textContent?.trim() || '',
                  timestamp: Date.now()
                });
              }
            });
          }

          // Detect active model from the model selector
          const modelSelector = document.querySelector(
            '[class*="model-selector"], [class*="chat-model"]'
          );
          const activeModel = modelSelector?.textContent?.trim() || null;

          // Detect if AI is currently generating
          const isGenerating = !!document.querySelector(
            '[class*="stop-button"]:not([style*="display: none"]), ' +
            '.codicon-debug-stop, ' +
            '[class*="generating"]'
          );

          // Count active agents (Manager View)
          const agentPanels = document.querySelectorAll(
            '[class*="agent-panel"], [class*="mission-control"] .agent'
          );

          return JSON.stringify({
            messages,
            activeModel,
            isGenerating,
            agentCount: agentPanels.length
          });
        })()
      `);

      if (typeof state === "string") {
        const parsed = JSON.parse(state);
        const oldMsgCount = this.state.messages.length;
        const oldIsGenerating = this.state.isGenerating;

        this.state.messages = parsed.messages;
        this.state.activeModel = parsed.activeModel;
        this.state.isGenerating = parsed.isGenerating;
        this.state.agentCount = parsed.agentCount;

        // Emit events on state changes
        if (parsed.messages.length !== oldMsgCount) {
          this.emit("messages_updated", this.state);
        }
        if (parsed.isGenerating !== oldIsGenerating) {
          this.emit("generation_status", parsed.isGenerating);
        }

        this.emit("state_updated", this.getState());
      }
    } catch (err) {
      // Poll failures are expected when IDE is loading or selectors change
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("CDP not connected")) {
        console.debug("[CDP] Poll failed:", msg);
      }
    }
  }

  private handleCDPEvent(method: string, params: unknown): void {
    // Forward DOM mutation events for real-time monitoring
    if (method === "DOM.documentUpdated") {
      // Re-enable DOM tracking after navigation
      this.enableDOMEvents().catch(() => {});
    }
  }

  /**
   * Send a chat message to the Antigravity IDE.
   */
  async sendChatMessage(text: string): Promise<void> {
    await this.evaluate(`
      (() => {
        const input = document.querySelector(
          '.chat-input-part textarea, ' +
          '[class*="chat-input"] textarea, ' +
          '.interactive-input textarea'
        );
        if (!input) throw new Error('Chat input not found');

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // Trigger send (Enter key)
        setTimeout(() => {
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
          }));
        }, 100);
      })()
    `);
  }

  /**
   * Stop the current generation.
   */
  async stopGeneration(): Promise<void> {
    await this.evaluate(`
      (() => {
        const stopBtn = document.querySelector(
          '[class*="stop-button"], .codicon-debug-stop'
        );
        if (stopBtn) stopBtn.click();
      })()
    `);
  }

  /**
   * Disconnect from CDP and stop all reconnection attempts.
   */
  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopPolling();
    this.rejectPendingCommands("CDP bridge disconnected");
    this.ws?.close();
    this.ws = null;
    this.state.connected = false;
  }
}
