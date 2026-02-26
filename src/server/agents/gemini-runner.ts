// =============================================================================
// Gemini CLI Runner
// =============================================================================
// Wraps Google's Gemini CLI in headless mode for programmatic agent execution.
// Uses JSON output format for structured communication.
// Reference: https://github.com/google-gemini/gemini-cli

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type { AgentRole } from "../../shared/types.js";

const GEMINI_CLI_PATH = process.env.GEMINI_CLI_PATH || "gemini";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-pro";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || "300000", 10);
const MAX_PROMPT_LENGTH = 50000; // ~50KB max prompt to prevent abuse
const MAX_CONVERSATION_HISTORY = 20;

/** System prompts per agent role */
const ROLE_PROMPTS: Record<AgentRole, string> = {
  architect: `You are a senior software architect. Your job is to analyze requirements, design system architecture, create implementation plans, and define file structures. Output structured plans with clear steps.`,
  frontend: `You are a frontend development specialist. You write clean, responsive, accessible UI code using modern frameworks (React, Next.js, Tailwind CSS). Focus on mobile-first design and PWA capabilities.`,
  backend: `You are a backend development specialist. You build robust APIs, handle data flows, implement authentication, and manage server infrastructure. Write secure, performant code.`,
  tester: `You are a QA and testing specialist. You write comprehensive unit tests, integration tests, and end-to-end tests. Identify edge cases and potential bugs. Suggest improvements for code quality.`,
  reviewer: `You are a code reviewer. Analyze code for bugs, security vulnerabilities, performance issues, and adherence to best practices. Provide actionable feedback.`,
  devops: `You are a DevOps specialist. You handle Docker configurations, CI/CD pipelines, Cloudflare Tunnel setup, deployment scripts, and infrastructure as code.`,
  general: `You are a helpful AI development assistant. You can help with any software engineering task including coding, debugging, documentation, and analysis.`,
};

export interface StreamChunk {
  type: "text" | "code" | "error" | "done";
  content: string;
}

export class GeminiRunner extends EventEmitter {
  private process: ChildProcess | null = null;
  private model: string;
  private role: AgentRole;
  private conversationHistory: Array<{ role: string; content: string }> = [];

  constructor(role: AgentRole, model?: string) {
    super();
    this.role = role;
    this.model = model || GEMINI_MODEL;
  }

  /**
   * Execute a prompt via Gemini CLI in headless mode with streaming output.
   */
  async execute(prompt: string): Promise<string> {
    if (prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Prompt too long (${prompt.length} chars, max ${MAX_PROMPT_LENGTH})`);
    }

    this.conversationHistory.push({ role: "user", content: prompt });
    // Cap conversation history to prevent unbounded memory growth
    if (this.conversationHistory.length > MAX_CONVERSATION_HISTORY) {
      this.conversationHistory = this.conversationHistory.slice(-MAX_CONVERSATION_HISTORY);
    }

    const systemPrompt = ROLE_PROMPTS[this.role];
    const contextPrompt = this.buildContextPrompt(systemPrompt, prompt);

    return new Promise((resolve, reject) => {
      const args = [
        "--output-format", "jsonl",
        "--model", this.model,
      ];

      // Only pass required env vars to child process (avoid leaking secrets)
      const env: Record<string, string> = {
        PATH: process.env.PATH || "",
        HOME: process.env.HOME || "",
        GEMINI_API_KEY: GEMINI_API_KEY,
        GOOGLE_API_KEY: GEMINI_API_KEY,
      };

      this.process = spawn(GEMINI_CLI_PATH, [...args, contextPrompt], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: AGENT_TIMEOUT_MS,
      });

      let output = "";
      let errorOutput = "";

      this.process.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        output += text;

        // Parse JSONL chunks and emit stream events
        const lines = text.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            const content = parsed.text || parsed.content || line;
            this.emit("stream", { type: "text", content } satisfies StreamChunk);
          } catch {
            // Plain text fallback
            this.emit("stream", { type: "text", content: text } satisfies StreamChunk);
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });

      this.process.on("close", (code) => {
        this.process = null;

        if (code === 0 || output.length > 0) {
          const result = this.parseOutput(output);
          this.conversationHistory.push({ role: "assistant", content: result });
          this.emit("stream", { type: "done", content: "" } satisfies StreamChunk);
          resolve(result);
        } else {
          const error = errorOutput || `Gemini CLI exited with code ${code}`;
          this.emit("stream", { type: "error", content: error } satisfies StreamChunk);
          reject(new Error(error));
        }
      });

      this.process.on("error", (err) => {
        this.process = null;
        this.emit("stream", { type: "error", content: err.message } satisfies StreamChunk);
        reject(err);
      });
    });
  }

  /**
   * Build the full prompt with system context and conversation history.
   */
  private buildContextPrompt(systemPrompt: string, userPrompt: string): string {
    const historyContext = this.conversationHistory
      .slice(-10) // Keep last 10 messages for context
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");

    return `${systemPrompt}\n\n--- Conversation History ---\n${historyContext}\n\n--- Current Request ---\n${userPrompt}`;
  }

  /**
   * Parse JSONL output from Gemini CLI into plain text.
   */
  private parseOutput(raw: string): string {
    const lines = raw.split("\n").filter(Boolean);
    const parts: string[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        parts.push(parsed.text || parsed.content || JSON.stringify(parsed));
      } catch {
        parts.push(line);
      }
    }

    return parts.join("");
  }

  /**
   * Stop the running process.
   */
  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

}
