// =============================================================================
// code-server Proxy Integration
// =============================================================================
// Proxies requests to a local code-server instance for browser-based code
// editing, protected by the same Cloudflare Access SSO layer.
//
// code-server provides a full VS Code experience in the browser, optimized
// for mobile. Combined with Cloudflare Access, this gives secure SSO-protected
// code editing from any device.
//
// Reference: https://github.com/coder/code-server
// SSO Tutorial: https://blog.samrhea.com/posts/2020/zero-trust-vs-code/

import { createProxyMiddleware, Options as ProxyOptions } from "http-proxy-middleware";
import type { Request, Response, NextFunction } from "express";

const CODE_SERVER_URL = process.env.CODE_SERVER_URL || "http://127.0.0.1:8080";

/**
 * Create Express middleware that proxies /code/* requests to code-server.
 * Authentication is handled by the Cloudflare Access layer before this.
 */
export function createCodeServerProxy() {
  const proxyOptions: ProxyOptions = {
    target: CODE_SERVER_URL,
    changeOrigin: true,
    ws: true,
    pathRewrite: { "^/code": "" },
    on: {
      proxyReq: (proxyReq, req) => {
        // Forward Cloudflare Access user identity to code-server
        const cfUser = (req as Request).headers["cf-access-jwt-assertion"];
        if (cfUser) {
          proxyReq.setHeader("X-Forwarded-User", cfUser as string);
        }
      },
      error: (err, _req, res) => {
        console.error("code-server proxy error:", err.message);
        if (res && "writeHead" in res) {
          (res as Response).status(502).json({
            ok: false,
            error: "code-server is not available. Start it with: code-server --bind-addr 127.0.0.1:8080 --auth none",
          });
        }
      },
    },
  };

  return createProxyMiddleware(proxyOptions);
}

/**
 * Health check for code-server availability.
 */
export async function checkCodeServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${CODE_SERVER_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
