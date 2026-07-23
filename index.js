const TRUSTPILOT_TOKEN_URL =
  "https://api.trustpilot.com/v1/oauth/oauth-business-users-for-applications/accesstoken";
const TRUSTPILOT_INVITATION_BASE =
  "https://invitations-api.trustpilot.com/v1/private/business-units";

const TOKEN_CACHE_KEY = "trustpilot:oauth:access_token";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_NAME = "Valued Customer";

const LIMITS = {
  email: 254,
  name: 120,
  referenceId: 128,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
};

export default {
  async fetch(request, env) {
    if (!isSecureRequest(request)) {
      return jsonResponse({ error: "HTTPS is required" }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    if (env.WORKER_API_KEY) {
      const apiKey = request.headers.get("X-Api-Key")?.trim();
      if (apiKey !== env.WORKER_API_KEY) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const validation = validateInput(body);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, validation.status);
    }

    const clientIp = getClientIp(request);
    const rateLimit = parseInt(env.RATE_LIMIT_PER_MINUTE ?? "60", 10);
    const rateKey = `rl:${validation.data.email}:${clientIp}`;
    const allowed = await checkRateLimit(env, rateKey, rateLimit);
    if (!allowed) {
      return jsonResponse({ error: "Rate limit exceeded" }, 429);
    }

    if (!env.TRUSTPILOT_API_KEY || !env.TRUSTPILOT_API_SECRET) {
      return jsonResponse({ error: "Trustpilot API credentials are not configured" }, 500);
    }

    const businessUnitId = env.TRUSTPILOT_BUSINESS_UNIT_ID;
    if (!businessUnitId) {
      return jsonResponse({ error: "TRUSTPILOT_BUSINESS_UNIT_ID is not configured" }, 500);
    }

    try {
      const accessToken = await getAccessToken(env);
      const invitation = await createInvitationLink(env, accessToken, businessUnitId, validation.data);
      return jsonResponse(
        {
          url: invitation.url,
          id: invitation.id,
        },
        200
      );
    } catch (error) {
      console.error("Failed to create invitation link:", error);
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Failed to create invitation link" },
        502
      );
    }
  },
};

function validateInput(body) {
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > LIMITS.email || !isValidEmail(email)) {
    return { ok: false, status: 400, error: "Valid email is required" };
  }

  const firstName = sanitizeText(body?.firstName, 60);
  const lastName = sanitizeText(body?.lastName, 60);
  const explicitName = sanitizeText(body?.name, LIMITS.name);
  const name =
    explicitName ||
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    DEFAULT_NAME;

  const referenceId =
    sanitizeText(body?.referenceId, LIMITS.referenceId) ||
    sanitizeText(body?.orderId, LIMITS.referenceId) ||
    crypto.randomUUID();

  return {
    ok: true,
    data: { email, name, referenceId },
  };
}

async function getAccessToken(env) {
  const cached = await env.TOKEN_CACHE.get(TOKEN_CACHE_KEY, "json");
  if (cached?.access_token && cached?.expires_at > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return cached.access_token;
  }

  const basicAuth = btoa(`${env.TRUSTPILOT_API_KEY}:${env.TRUSTPILOT_API_SECRET}`);
  const response = await fetch(TRUSTPILOT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Trustpilot OAuth failed (${response.status}): ${detail}`);
  }

  const tokenData = await response.json();
  if (!tokenData.access_token) {
    throw new Error("Trustpilot OAuth response missing access_token");
  }

  const expiresInMs = Number.parseInt(tokenData.expires_in ?? "359999", 10) * 1000;
  const expiresAt = Date.now() + expiresInMs;

  await env.TOKEN_CACHE.put(
    TOKEN_CACHE_KEY,
    JSON.stringify({
      access_token: tokenData.access_token,
      expires_at: expiresAt,
    }),
    { expirationTtl: Math.max(Math.floor(expiresInMs / 1000) - 60, 60) }
  );

  return tokenData.access_token;
}

async function createInvitationLink(env, accessToken, businessUnitId, customer) {
  const payload = {
    referenceId: customer.referenceId,
    email: customer.email,
    name: customer.name,
    locale: env.TRUSTPILOT_LOCALE || "en-US",
  };

  if (env.TRUSTPILOT_REDIRECT_URI) {
    payload.redirectUri = env.TRUSTPILOT_REDIRECT_URI;
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  if (env.TRUSTPILOT_BUSINESS_USER_ID) {
    headers["x-business-user-id"] = env.TRUSTPILOT_BUSINESS_USER_ID;
  }

  const response = await fetch(
    `${TRUSTPILOT_INVITATION_BASE}/${businessUnitId}/invitation-links`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Trustpilot invitation API failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  if (!data.url) {
    throw new Error("Trustpilot invitation API response missing url");
  }

  return data;
}

async function checkRateLimit(env, rateKey, limitPerMinute) {
  if (!env.TOKEN_CACHE || !limitPerMinute || limitPerMinute <= 0) {
    return true;
  }

  const key = `rl:${rateKey}`;
  const currentRaw = await env.TOKEN_CACHE.get(key);
  const current = currentRaw ? Number.parseInt(currentRaw, 10) : 0;

  if (current >= limitPerMinute) {
    return false;
  }

  await env.TOKEN_CACHE.put(key, String(current + 1), { expirationTtl: 60 });
  return true;
}

function isSecureRequest(request) {
  const url = new URL(request.url);
  if (url.protocol === "https:") {
    return true;
  }

  const host = url.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") {
    return undefined;
  }

  let text = value.trim();
  if (!text) {
    return undefined;
  }

  text = text.replace(/<[^>]*>/g, "");
  text = text.replace(/javascript:/gi, "");
  text = text.replace(/on\w+\s*=/gi, "");
  text = text.replace(/[\u0000-\u001F\u007F]/g, "");

  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }

  return text;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function btoa(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}
