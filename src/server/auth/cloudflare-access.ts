// =============================================================================
// Cloudflare Access JWT Verification Middleware
// =============================================================================
// Validates JWT tokens issued by Cloudflare Access to enforce SSO authentication.
// Reference: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import type { AuthenticatedUser, CloudflareJWTPayload } from "../../shared/types.js";

const CF_TEAM_DOMAIN = process.env.CF_TEAM_DOMAIN || "";
const CF_APP_AUD = process.env.CF_APP_AUD || "";
const CF_POLICY_BYPASS = process.env.CF_POLICY_BYPASS === "true";

// JWKS client for fetching Cloudflare's public signing keys
const jwks = jwksClient({
  jwksUri: `${CF_TEAM_DOMAIN}/cdn-cgi/access/certs`,
  cache: true,
  cacheMaxAge: 600_000, // 10 minutes
  rateLimit: true,
});

function getSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      if (!key) return reject(new Error("No signing key found"));
      resolve(key.getPublicKey());
    });
  });
}

/**
 * Verify a Cloudflare Access JWT token.
 * Tokens are sent via the `Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie.
 */
export async function verifyCloudflareToken(token: string): Promise<CloudflareJWTPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string" || !decoded.header.kid) {
    throw new Error("Invalid JWT structure");
  }

  const signingKey = await getSigningKey(decoded.header.kid);

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      signingKey,
      {
        audience: CF_APP_AUD,
        issuer: `${CF_TEAM_DOMAIN}`,
        algorithms: ["RS256"],
      },
      (err, payload) => {
        if (err) return reject(err);
        resolve(payload as CloudflareJWTPayload);
      }
    );
  });
}

/**
 * Extract the JWT token from the request.
 * Cloudflare Access sends it via header or cookie.
 */
function extractToken(req: Request): string | null {
  // Header: Cf-Access-Jwt-Assertion
  const headerToken = req.headers["cf-access-jwt-assertion"];
  if (typeof headerToken === "string" && headerToken) {
    return headerToken;
  }

  // Cookie: CF_Authorization
  const cookies = req.headers.cookie;
  if (cookies) {
    const match = cookies.match(/CF_Authorization=([^;]+)/);
    if (match) return match[1];
  }

  return null;
}

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Express middleware that enforces Cloudflare Access authentication.
 * In development mode (CF_POLICY_BYPASS=true), allows unauthenticated requests
 * with a mock user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Development bypass
  if (CF_POLICY_BYPASS) {
    req.user = {
      email: "dev@localhost",
      name: "Development User",
      sub: "dev-local",
    };
    next();
    return;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Authentication required" });
    return;
  }

  verifyCloudflareToken(token)
    .then((payload) => {
      req.user = {
        email: payload.email,
        sub: payload.sub,
      };
      next();
    })
    .catch((err) => {
      console.error("JWT verification failed:", err.message);
      res.status(403).json({ ok: false, error: "Invalid or expired token" });
    });
}
