// =============================================================================
// Git Bridge - Secure git operations for bed-to-commit workflow
// =============================================================================
// Provides secure git operations with:
// - HMAC-signed approval tokens (prevents unauthorized commits)
// - Path traversal prevention
// - Command injection prevention (uses execFile, not shell)
// - Configurable allowed branches
// - Operation audit logging
// - Rate limiting per user

import { execFile } from "child_process";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import type { CommitRequest, CommitFile, CommitResult, GitStatus } from "../../shared/types.js";

const WORKSPACE_PATH = process.env.WORKSPACE_PATH || process.cwd();
const ALLOWED_BRANCHES = (process.env.ALLOWED_BRANCHES || "main,master,develop,feature/*").split(",").map((b) => b.trim());
const APPROVAL_TTL_MS = parseInt(process.env.APPROVAL_TTL_MS || "600000", 10); // 10 min
const HMAC_SECRET = process.env.HMAC_SECRET || randomBytes(32).toString("hex");
const MAX_COMMITS_PER_HOUR = parseInt(process.env.MAX_COMMITS_PER_HOUR || "20", 10);

interface AuditEntry {
  timestamp: number;
  action: string;
  user: string;
  pipelineId: string;
  branch: string;
  result: "success" | "denied" | "error";
  detail?: string;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export class GitBridge {
  private auditLog: AuditEntry[] = [];
  private rateLimits = new Map<string, RateLimitEntry>();

  /**
   * Generate an HMAC-signed approval token for a commit request.
   * Token is time-limited and bound to the specific pipeline.
   */
  generateApprovalToken(pipelineId: string): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + APPROVAL_TTL_MS;
    const nonce = randomBytes(16).toString("hex");
    const payload = `${pipelineId}:${expiresAt}:${nonce}`;
    const hmac = createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
    const token = `${payload}:${hmac}`;
    return { token, expiresAt };
  }

  /**
   * Verify an approval token. Uses timing-safe comparison to prevent timing attacks.
   */
  verifyApprovalToken(token: string, pipelineId: string): boolean {
    const parts = token.split(":");
    if (parts.length !== 4) return false;

    const [tokenPipelineId, expiresAtStr, nonce, providedHmac] = parts;

    // Check pipeline ID match
    if (tokenPipelineId !== pipelineId) return false;

    // Check expiry
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

    // Verify HMAC (timing-safe)
    const payload = `${tokenPipelineId}:${expiresAtStr}:${nonce}`;
    const expectedHmac = createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");

    try {
      return timingSafeEqual(Buffer.from(providedHmac, "hex"), Buffer.from(expectedHmac, "hex"));
    } catch {
      return false;
    }
  }

  /**
   * Validate a file path to prevent path traversal attacks.
   */
  validateFilePath(filePath: string): boolean {
    // Reject empty paths
    if (!filePath || filePath.trim().length === 0) return false;

    // Reject absolute paths
    if (path.isAbsolute(filePath)) return false;

    // Reject path traversal
    const normalized = path.normalize(filePath);
    if (normalized.startsWith("..") || normalized.includes("/../") || normalized.includes("\\..\\")) {
      return false;
    }

    // Reject hidden files/directories (except .gitignore etc.)
    const ALLOWED_DOT_FILES = [".gitignore", ".gitattributes", ".env.example", ".eslintrc", ".prettierrc"];
    const segments = normalized.split(path.sep);
    for (const segment of segments) {
      if (segment.startsWith(".") && !ALLOWED_DOT_FILES.includes(segment)) {
        return false;
      }
    }

    // Reject dangerous file types
    const BLOCKED_EXTENSIONS = [".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1", ".exe", ".dll", ".so"];
    const ext = path.extname(filePath).toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) return false;

    // Reject sensitive paths
    const BLOCKED_PATHS = [".env", ".env.local", ".env.production", "credentials", "secrets", ".ssh", ".gnupg"];
    if (BLOCKED_PATHS.some((p) => normalized.includes(p))) return false;

    return true;
  }

  /**
   * Validate that a branch name is allowed.
   */
  validateBranch(branch: string): boolean {
    // Sanitize: reject special characters that could be used for injection
    if (!/^[a-zA-Z0-9\-_./]+$/.test(branch)) return false;

    return ALLOWED_BRANCHES.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
        return regex.test(branch);
      }
      return pattern === branch;
    });
  }

  /**
   * Check rate limit for a user. Returns true if within limit.
   */
  checkRateLimit(userEmail: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(userEmail);

    if (!entry || now - entry.windowStart > 3600_000) {
      this.rateLimits.set(userEmail, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= MAX_COMMITS_PER_HOUR) return false;

    entry.count++;
    return true;
  }

  /**
   * Get the current git status of the workspace.
   */
  async getStatus(): Promise<GitStatus> {
    const [branchResult, statusResult, logResult] = await Promise.all([
      this.git(["rev-parse", "--abbrev-ref", "HEAD"]),
      this.git(["status", "--porcelain"]),
      this.git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).catch(() => "0\t0"),
    ]);

    const branch = branchResult.trim();
    const lines = statusResult.split("\n").filter(Boolean);
    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const indexStatus = line[0];
      const workStatus = line[1];
      const file = line.slice(3);

      if (indexStatus !== " " && indexStatus !== "?") staged.push(file);
      if (workStatus === "M" || workStatus === "D") modified.push(file);
      if (indexStatus === "?" && workStatus === "?") untracked.push(file);
    }

    const [ahead, behind] = logResult.trim().split("\t").map(Number);

    return {
      branch,
      clean: lines.length === 0,
      staged,
      modified,
      untracked,
      ahead: ahead || 0,
      behind: behind || 0,
    };
  }

  /**
   * Write files to disk for diff preview (before commit approval).
   * Does NOT stage them - just writes so we can show a diff.
   */
  async writeFilesForPreview(files: CommitFile[]): Promise<void> {
    await this.writeFiles(files);
  }

  /**
   * Get a diff of unstaged changes for preview.
   */
  async getPreviewDiff(files: CommitFile[]): Promise<string> {
    const paths = files.filter((f) => f.content).map((f) => f.path);
    if (paths.length === 0) return "(no changes)";
    try {
      return await this.git(["diff", "--", ...paths]);
    } catch {
      return await this.git(["diff", "--stat"]).catch(() => "(diff unavailable)");
    }
  }

  /**
   * Execute the commit workflow with full security validation.
   */
  async executeCommit(
    request: CommitRequest,
    userEmail: string,
  ): Promise<CommitResult> {
    // 0. Validate email format
    if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(userEmail)) {
      throw new Error("Invalid email format for commit author");
    }

    // 1. Rate limit check
    if (!this.checkRateLimit(userEmail)) {
      this.audit("commit", userEmail, request.pipelineId, request.branch, "denied", "Rate limit exceeded");
      throw new Error("Rate limit exceeded. Maximum commits per hour reached.");
    }

    // 2. Verify approval token
    if (!this.verifyApprovalToken(request.approvalToken, request.pipelineId)) {
      this.audit("commit", userEmail, request.pipelineId, request.branch, "denied", "Invalid or expired approval token");
      throw new Error("Invalid or expired approval token. Please re-approve.");
    }

    // 3. Validate branch
    if (!this.validateBranch(request.branch)) {
      this.audit("commit", userEmail, request.pipelineId, request.branch, "denied", "Branch not allowed");
      throw new Error(`Branch '${request.branch}' is not in the allowed list. Allowed: ${ALLOWED_BRANCHES.join(", ")}`);
    }

    // 4. Validate all file paths
    for (const file of request.files) {
      if (!this.validateFilePath(file.path)) {
        this.audit("commit", userEmail, request.pipelineId, request.branch, "denied", `Invalid file path: ${file.path}`);
        throw new Error(`Invalid file path: ${file.path}`);
      }
    }

    // 5. Sanitize commit message
    const sanitizedMessage = this.sanitizeCommitMessage(request.message);

    try {
      // Write file contents to disk (critical: without this, git add operates on stale/missing files)
      await this.writeFiles(request.files);

      // Stage files
      const filePaths = request.files.filter((f) => f.action !== "delete").map((f) => f.path);
      const deletedPaths = request.files.filter((f) => f.action === "delete").map((f) => f.path);
      if (filePaths.length > 0) await this.git(["add", ...filePaths]);
      if (deletedPaths.length > 0) await this.git(["rm", ...deletedPaths]);

      // Create commit
      await this.git(["commit", "-m", sanitizedMessage, "--author", `AntiClaw <anticlaw@${userEmail}>`]);

      // Get commit info
      const hash = (await this.git(["rev-parse", "HEAD"])).trim();
      const diffStat = await this.git(["diff", "--stat", "HEAD~1", "HEAD"]);

      // Parse stat
      const statMatch = diffStat.match(/(\d+) files? changed(?:, (\d+) insertions?)?(?:, (\d+) deletions?)?/);
      const filesChanged = statMatch ? parseInt(statMatch[1], 10) : request.files.length;
      const insertions = statMatch ? parseInt(statMatch[2] || "0", 10) : 0;
      const deletions = statMatch ? parseInt(statMatch[3] || "0", 10) : 0;

      const result: CommitResult = {
        hash,
        branch: request.branch,
        message: sanitizedMessage,
        filesChanged,
        insertions,
        deletions,
        timestamp: Date.now(),
        pushed: false,
      };

      this.audit("commit", userEmail, request.pipelineId, request.branch, "success", `Commit ${hash}`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Commit failed";
      this.audit("commit", userEmail, request.pipelineId, request.branch, "error", msg);
      throw new Error(`Commit failed: ${msg}`);
    }
  }

  /**
   * Push committed changes to remote.
   */
  async push(branch: string, userEmail: string, pipelineId: string): Promise<void> {
    if (!this.validateBranch(branch)) {
      throw new Error(`Cannot push to branch '${branch}': not in allowed list`);
    }

    try {
      await this.git(["push", "origin", branch]);
      this.audit("push", userEmail, pipelineId, branch, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Push failed";
      this.audit("push", userEmail, pipelineId, branch, "error", msg);
      throw new Error(`Push failed: ${msg}`);
    }
  }

  /**
   * Get audit log entries (last 100).
   */
  getAuditLog(): AuditEntry[] {
    return this.auditLog.slice(-100);
  }

  /**
   * Write file contents to disk before staging.
   * Only writes files that have content (AI-generated).
   * Creates parent directories as needed.
   */
  private async writeFiles(files: CommitFile[]): Promise<void> {
    for (const file of files) {
      if (file.action === "delete" || !file.content) continue;

      const fullPath = path.join(WORKSPACE_PATH, file.path);
      const dir = path.dirname(fullPath);

      // Ensure parent directory exists
      await mkdir(dir, { recursive: true });

      // Write file content
      await writeFile(fullPath, file.content, "utf-8");
    }
  }

  /**
   * Sanitize a commit message to prevent injection.
   */
  private sanitizeCommitMessage(message: string): string {
    return message
      .replace(/[^\x20-\x7E\n\r\t\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g, "") // Allow ASCII + Japanese
      .slice(0, 500) // Max 500 chars
      .trim();
  }

  /**
   * Record an audit entry.
   */
  private audit(
    action: string,
    user: string,
    pipelineId: string,
    branch: string,
    result: "success" | "denied" | "error",
    detail?: string
  ): void {
    this.auditLog.push({
      timestamp: Date.now(),
      action,
      user,
      pipelineId,
      branch,
      result,
      detail,
    });

    // Keep last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }

    // Log to console for observability
    console.log(`[GIT_AUDIT] ${action} by ${user} on ${branch}: ${result}${detail ? ` (${detail})` : ""}`);
  }

  /**
   * Execute a git command safely using execFile (not shell).
   * This prevents command injection as arguments are passed as an array.
   */
  private git(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: WORKSPACE_PATH, timeout: 30_000 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
