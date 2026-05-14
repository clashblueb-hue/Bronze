const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    return new Response("Not found.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch (error) {
    throw new Error("Invalid JSON body.");
  }
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function getBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return "";
  }
  return header.slice("Bearer ".length).trim();
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function createRandomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex),
      iterations: 100000,
      hash: "SHA-512",
    },
    key,
    512
  );
  return bytesToHex(new Uint8Array(bits));
}

function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

async function verifyPassword(password, saltHex, expectedHash) {
  const calculated = await hashPassword(password, saltHex);
  return safeEqual(calculated, expectedHash);
}

async function dbFirst(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}

async function dbRun(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
  };
}

async function getSessionUser(request, env) {
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const row = await dbFirst(
    env,
    `SELECT users.id, users.username, users.state_json
     FROM sessions
     INNER JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`,
    token
  );

  if (!row) {
    return null;
  }

  return {
    token,
    user: row,
  };
}

async function handleApi(request, env, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/healthz") {
      return jsonResponse({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/register") {
      const body = await parseJsonBody(request);
      const username = normalizeUsername(body.username);
      const password = String(body.password || "");

      if (username.length < 3 || username.length > 24) {
        return jsonResponse({ message: "Username must be 3 to 24 characters." }, 400);
      }

      if (password.length < 4) {
        return jsonResponse({ message: "Password must be at least 4 characters." }, 400);
      }

      const existing = await dbFirst(
        env,
        "SELECT id FROM users WHERE username = ?",
        username
      );

      if (existing) {
        return jsonResponse({ message: "That username is already taken." }, 409);
      }

      const userId = crypto.randomUUID();
      const salt = createRandomHex(16);
      const passwordHash = await hashPassword(password, salt);
      const now = new Date().toISOString();

      await dbRun(
        env,
        `INSERT INTO users (id, username, salt, password_hash, state_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        userId,
        username,
        salt,
        passwordHash,
        now,
        now
      );

      const token = createRandomHex(32);
      await dbRun(
        env,
        `INSERT INTO sessions (token, user_id, created_at)
         VALUES (?, ?, ?)`,
        token,
        userId,
        now
      );

      return jsonResponse(
        {
          token,
          user: publicUser({ id: userId, username }),
        },
        201
      );
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await parseJsonBody(request);
      const username = normalizeUsername(body.username);
      const password = String(body.password || "");

      const user = await dbFirst(
        env,
        `SELECT id, username, salt, password_hash
         FROM users
         WHERE username = ?`,
        username
      );

      if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
        return jsonResponse({ message: "Invalid username or password." }, 401);
      }

      const token = createRandomHex(32);
      await dbRun(
        env,
        `INSERT INTO sessions (token, user_id, created_at)
         VALUES (?, ?, ?)`,
        token,
        user.id,
        new Date().toISOString()
      );

      return jsonResponse({
        token,
        user: publicUser(user),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      const token = getBearerToken(request);
      if (token) {
        await dbRun(env, "DELETE FROM sessions WHERE token = ?", token);
      }
      return jsonResponse({ ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/me") {
      const session = await getSessionUser(request, env);
      if (!session) {
        return jsonResponse({ message: "Unauthorized." }, 401);
      }
      return jsonResponse({
        user: publicUser(session.user),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/state") {
      const session = await getSessionUser(request, env);
      if (!session) {
        return jsonResponse({ message: "Unauthorized." }, 401);
      }

      let state = null;
      if (session.user.state_json) {
        try {
          state = JSON.parse(session.user.state_json);
        } catch (error) {
          state = null;
        }
      }

      return jsonResponse({ state });
    }

    if (request.method === "PUT" && url.pathname === "/api/state") {
      const session = await getSessionUser(request, env);
      if (!session) {
        return jsonResponse({ message: "Unauthorized." }, 401);
      }

      const body = await parseJsonBody(request);
      if (!body || typeof body.state !== "object" || body.state === null) {
        return jsonResponse({ message: "Missing or invalid state payload." }, 400);
      }

      await dbRun(
        env,
        `UPDATE users
         SET state_json = ?, updated_at = ?
         WHERE id = ?`,
        JSON.stringify(body.state),
        new Date().toISOString(),
        session.user.id
      );

      return jsonResponse({ ok: true });
    }

    return jsonResponse({ message: "Not found." }, 404);
  } catch (error) {
    return jsonResponse({ message: error.message || "Server error." }, 500);
  }
}
