import { createHash, timingSafeEqual } from "node:crypto";
import process from "node:process";

import { coerceBoolean, coerceNumber } from "./options.js";

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

function safeCompare(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

function parseBasicAuthHeader(headerValue) {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

function getClientId(request, trustProxy) {
  if (trustProxy) {
    const forwardedFor = request.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0].trim();
    }
  }

  return request.socket.remoteAddress || "unknown";
}

export function resolveSecurityConfig(env = process.env) {
  const authUser = env.BASIC_AUTH_USER ?? "";
  const authPassword = env.BASIC_AUTH_PASSWORD ?? "";
  const authEnabled = authUser.length > 0 || authPassword.length > 0;

  if (authEnabled && (!authUser || !authPassword)) {
    throw new Error("Set both BASIC_AUTH_USER and BASIC_AUTH_PASSWORD to enable basic auth.");
  }

  const rateLimitMaxRequests = env.RATE_LIMIT_MAX_REQUESTS;
  const rateLimitEnabled = rateLimitMaxRequests !== undefined && String(rateLimitMaxRequests).trim() !== "";
  const maxRequests = rateLimitEnabled ? coerceNumber(rateLimitMaxRequests, 10) : null;
  const windowMs = rateLimitEnabled ? coerceNumber(env.RATE_LIMIT_WINDOW_MS, 60_000) : null;

  if (rateLimitEnabled && maxRequests <= 0) {
    throw new Error("RATE_LIMIT_MAX_REQUESTS must be greater than zero.");
  }

  if (rateLimitEnabled && windowMs <= 0) {
    throw new Error("RATE_LIMIT_WINDOW_MS must be greater than zero.");
  }

  return {
    auth: {
      enabled: authEnabled,
      realm: env.BASIC_AUTH_REALM || "Field Scraper",
      username: authUser,
      password: authPassword
    },
    rateLimit: {
      enabled: rateLimitEnabled,
      maxRequests,
      windowMs,
      trustProxy: coerceBoolean(env.TRUST_PROXY, false)
    }
  };
}

export function isAuthorized(request, authConfig) {
  if (!authConfig.enabled) {
    return true;
  }

  const credentials = parseBasicAuthHeader(request.headers.authorization);
  if (!credentials) {
    return false;
  }

  return (
    safeCompare(credentials.username, authConfig.username) &&
    safeCompare(credentials.password, authConfig.password)
  );
}

export function createRateLimiter(config) {
  if (!config.enabled) {
    return {
      check() {
        return {
          allowed: true,
          headers: {}
        };
      }
    };
  }

  const windows = new Map();

  function cleanup(now) {
    for (const [key, value] of windows.entries()) {
      if (value.resetAt <= now) {
        windows.delete(key);
      }
    }
  }

  return {
    check(request) {
      const now = Date.now();
      cleanup(now);

      const clientId = getClientId(request, config.trustProxy);
      const current = windows.get(clientId);

      if (!current || current.resetAt <= now) {
        const nextWindow = {
          count: 1,
          resetAt: now + config.windowMs
        };
        windows.set(clientId, nextWindow);

        return {
          allowed: true,
          headers: {
            "X-RateLimit-Limit": String(config.maxRequests),
            "X-RateLimit-Remaining": String(Math.max(config.maxRequests - 1, 0)),
            "X-RateLimit-Reset": String(Math.ceil(nextWindow.resetAt / 1000))
          }
        };
      }

      if (current.count >= config.maxRequests) {
        return {
          allowed: false,
          headers: {
            "Retry-After": String(Math.max(Math.ceil((current.resetAt - now) / 1000), 1)),
            "X-RateLimit-Limit": String(config.maxRequests),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(current.resetAt / 1000))
          }
        };
      }

      current.count += 1;

      return {
        allowed: true,
        headers: {
          "X-RateLimit-Limit": String(config.maxRequests),
          "X-RateLimit-Remaining": String(Math.max(config.maxRequests - current.count, 0)),
          "X-RateLimit-Reset": String(Math.ceil(current.resetAt / 1000))
        }
      };
    }
  };
}
