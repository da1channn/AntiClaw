// =============================================================================
// Team Agent Orchestrator - Bed-to-Commit Bridge Pipeline
// =============================================================================
// Orchestrates a team of specialized AI agents through a structured pipeline:
//   1. Architect: Analyze task, design solution, plan file changes
//   2. Frontend/Backend (parallel): Implement the changes
//   3. Tester: Write tests and validate
//   4. Reviewer: Code review and security audit
//
// The pipeline output is collected and fed to the git bridge for commit.

import { v4 as uuidv4 } from "uuid";
import { GeminiRunner, StreamChunk } from "./gemini-runner.js";
import type {
  AgentRole,
  PipelineStage,
  PipelineStageStatus,
  PipelineStatus,
  TeamPipeline,
} from "../../shared/types.js";

const PIPELINE_TIMEOUT_MS = parseInt(process.env.PIPELINE_TIMEOUT_MS || "600000", 10); // 10 min

/** Default pipeline stages executed in order. Parallel stages share the same group index. */
const DEFAULT_PIPELINE: Array<{ role: AgentRole; group: number }> = [
  { role: "architect", group: 0 },
  { role: "frontend", group: 1 },
  { role: "backend", group: 1 },
  { role: "tester", group: 2 },
  { role: "reviewer", group: 3 },
];

/** Prompts injected into each stage so that agents produce structured output. */
const STAGE_META_PROMPTS: Record<string, string> = {
  architect: `You are the lead architect in a team pipeline. Analyze the following task and produce:
1. A clear implementation plan with specific file paths and changes
2. Which roles (frontend, backend) should handle which parts
3. Any security considerations

Output your plan in a structured format with clear sections.
Mark file changes with: [FILE: path/to/file] ACTION: create|modify|delete
End with a section: [HANDOFF] containing the instructions for the next stage.`,

  frontend: `You are the frontend developer in a team pipeline.
The architect has provided a plan. Implement ONLY the frontend changes described.
Output complete file contents for each file you create or modify.
Use the format:
\`\`\`language
// file: path/to/file
<full file content>
\`\`\`
Be precise. Do not add unnecessary changes. Follow the architect's plan exactly.`,

  backend: `You are the backend developer in a team pipeline.
The architect has provided a plan. Implement ONLY the backend changes described.
Output complete file contents for each file you create or modify.
Use the format:
\`\`\`language
// file: path/to/file
<full file content>
\`\`\`
Be precise. Do not add unnecessary changes. Follow the architect's plan exactly.`,

  tester: `You are the QA tester in a team pipeline.
Review all the code changes from the previous stages. Check for:
1. Correctness and completeness
2. Edge cases and potential bugs
3. Security vulnerabilities (injection, XSS, path traversal, etc.)
Provide a structured test report. Flag any BLOCKING issues that must be fixed.
If everything is acceptable, end with: [APPROVED]`,

  reviewer: `You are the code reviewer in a team pipeline.
Perform a final review of all changes. Evaluate:
1. Code quality and best practices
2. Security (OWASP Top 10)
3. Performance implications
4. Consistency with existing codebase

Produce a concise review summary. If changes are safe to commit, end with: [APPROVED]
If there are blocking issues, end with: [BLOCKED] and list the issues.
Also suggest a git commit message in the format: [COMMIT_MSG] <message>`,
};

interface StageRunner {
  runner: GeminiRunner;
  stage: PipelineStage;
}

export class TeamOrchestrator {
  private activeRunners = new Map<string, StageRunner[]>();

  // Callbacks
  public onPipelineUpdate?: (sessionId: string, pipeline: TeamPipeline) => void;
  public onStageStream?: (sessionId: string, pipelineId: string, stageId: string, chunk: string) => void;
  public onPipelineComplete?: (sessionId: string, pipeline: TeamPipeline) => void;
  public onError?: (sessionId: string, pipelineId: string, error: string) => void;

  /**
   * Start a team pipeline for a given task.
   */
  async startPipeline(sessionId: string, task: string, model?: string): Promise<TeamPipeline> {
    const pipelineId = uuidv4();
    const stages: PipelineStage[] = DEFAULT_PIPELINE.map(({ role }) => ({
      id: uuidv4(),
      role,
      status: "pending" as PipelineStageStatus,
    }));

    const pipeline: TeamPipeline = {
      id: pipelineId,
      sessionId,
      task,
      status: "planning",
      stages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.onPipelineUpdate?.(sessionId, pipeline);

    // Execute pipeline asynchronously
    this.executePipeline(sessionId, pipeline, model).catch((err) => {
      pipeline.status = "error";
      pipeline.updatedAt = Date.now();
      this.onError?.(sessionId, pipelineId, err instanceof Error ? err.message : "Pipeline failed");
      this.onPipelineUpdate?.(sessionId, pipeline);
    });

    return pipeline;
  }

  /**
   * Cancel a running pipeline.
   */
  cancelPipeline(pipelineId: string): void {
    const runners = this.activeRunners.get(pipelineId);
    if (runners) {
      for (const { runner } of runners) {
        runner.stop();
      }
      this.activeRunners.delete(pipelineId);
    }
  }

  /**
   * Execute all stages of the pipeline sequentially (with parallel groups).
   */
  private async executePipeline(sessionId: string, pipeline: TeamPipeline, model?: string): Promise<void> {
    const timeout = setTimeout(() => {
      this.cancelPipeline(pipeline.id);
      pipeline.status = "error";
      pipeline.updatedAt = Date.now();
      this.onError?.(sessionId, pipeline.id, "Pipeline timed out");
      this.onPipelineUpdate?.(sessionId, pipeline);
    }, PIPELINE_TIMEOUT_MS);

    try {
      // Group stages by their parallel group index
      const groups = new Map<number, PipelineStage[]>();
      for (let i = 0; i < DEFAULT_PIPELINE.length; i++) {
        const group = DEFAULT_PIPELINE[i].group;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push(pipeline.stages[i]);
      }

      let previousOutput = `TASK: ${pipeline.task}`;

      // Execute each group sequentially, stages within a group in parallel
      const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => a - b);

      for (const [, stageGroup] of sortedGroups) {
        pipeline.status = stageGroup[0].role === "architect" ? "planning" : "executing";
        if (stageGroup.some((s) => s.role === "reviewer")) {
          pipeline.status = "reviewing";
        }
        pipeline.updatedAt = Date.now();
        this.onPipelineUpdate?.(sessionId, pipeline);

        // Run all stages in this group in parallel
        const results = await Promise.all(
          stageGroup.map((stage) =>
            this.executeStage(sessionId, pipeline, stage, previousOutput, model)
          )
        );

        // Collect outputs from this group for the next group's context
        const groupOutput = results
          .map((r, i) => `=== ${stageGroup[i].role.toUpperCase()} OUTPUT ===\n${r}`)
          .join("\n\n");

        previousOutput = `${previousOutput}\n\n${groupOutput}`;
      }

      // Pipeline complete - move to awaiting approval
      pipeline.status = "awaiting_approval";
      pipeline.updatedAt = Date.now();
      this.onPipelineComplete?.(sessionId, pipeline);
      this.onPipelineUpdate?.(sessionId, pipeline);
    } catch (err) {
      pipeline.status = "error";
      pipeline.updatedAt = Date.now();
      const msg = err instanceof Error ? err.message : "Pipeline execution failed";
      this.onError?.(sessionId, pipeline.id, msg);
      this.onPipelineUpdate?.(sessionId, pipeline);
    } finally {
      clearTimeout(timeout);
      this.activeRunners.delete(pipeline.id);
    }
  }

  /**
   * Execute a single pipeline stage.
   */
  private async executeStage(
    sessionId: string,
    pipeline: TeamPipeline,
    stage: PipelineStage,
    context: string,
    model?: string
  ): Promise<string> {
    stage.status = "running";
    stage.startedAt = Date.now();
    stage.input = context;
    pipeline.updatedAt = Date.now();
    this.onPipelineUpdate?.(sessionId, pipeline);

    const runner = new GeminiRunner(stage.role, model);

    // Track active runner for cancellation
    if (!this.activeRunners.has(pipeline.id)) {
      this.activeRunners.set(pipeline.id, []);
    }
    this.activeRunners.get(pipeline.id)!.push({ runner, stage });

    // Set up streaming
    runner.on("stream", (chunk: StreamChunk) => {
      if (chunk.type === "text") {
        this.onStageStream?.(sessionId, pipeline.id, stage.id, chunk.content);
      }
    });

    try {
      const metaPrompt = STAGE_META_PROMPTS[stage.role] || "";
      const fullPrompt = `${metaPrompt}\n\n--- Context from previous stages ---\n${context}`;

      const output = await runner.execute(fullPrompt);

      stage.status = "completed";
      stage.output = output;
      stage.completedAt = Date.now();
      pipeline.updatedAt = Date.now();
      this.onPipelineUpdate?.(sessionId, pipeline);

      return output;
    } catch (err) {
      stage.status = "error";
      stage.error = err instanceof Error ? err.message : "Stage failed";
      stage.completedAt = Date.now();
      pipeline.updatedAt = Date.now();
      this.onPipelineUpdate?.(sessionId, pipeline);

      throw err;
    } finally {
      runner.removeAllListeners("stream");
    }
  }

  /**
   * Collect all file changes from pipeline stage outputs.
   * Parses code blocks with file path annotations.
   */
  collectFileChanges(pipeline: TeamPipeline): Array<{ path: string; content: string; language: string }> {
    const files: Array<{ path: string; content: string; language: string }> = [];
    const seen = new Set<string>();

    for (const stage of pipeline.stages) {
      if (!stage.output) continue;

      // Match code blocks with file path annotations
      const codeBlockRegex = /```(\w+)?\n\/\/\s*file:\s*(.+)\n([\s\S]*?)```/g;
      let match;
      while ((match = codeBlockRegex.exec(stage.output)) !== null) {
        const language = match[1] || "text";
        const filePath = match[2].trim();
        const content = match[3].trim();

        // Later stages override earlier ones for the same file
        if (seen.has(filePath)) {
          const idx = files.findIndex((f) => f.path === filePath);
          if (idx >= 0) files[idx] = { path: filePath, content, language };
        } else {
          seen.add(filePath);
          files.push({ path: filePath, content, language });
        }
      }

      // Also try: # file: path format (for non-JS languages)
      const altRegex = /```(\w+)?\n#\s*file:\s*(.+)\n([\s\S]*?)```/g;
      while ((match = altRegex.exec(stage.output)) !== null) {
        const language = match[1] || "text";
        const filePath = match[2].trim();
        const content = match[3].trim();

        if (!seen.has(filePath)) {
          seen.add(filePath);
          files.push({ path: filePath, content, language });
        }
      }
    }

    return files;
  }

  /**
   * Extract suggested commit message from the reviewer stage.
   */
  extractCommitMessage(pipeline: TeamPipeline): string {
    const reviewerStage = pipeline.stages.find((s) => s.role === "reviewer");
    if (reviewerStage?.output) {
      const match = reviewerStage.output.match(/\[COMMIT_MSG\]\s*(.+)/);
      if (match) return match[1].trim();
    }
    return `feat: ${pipeline.task}`;
  }
}
