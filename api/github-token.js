const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const DEFAULT_CLIENT_ID = "Ov23liaN2AWMm6wNOubq";
const DEFAULT_REDIRECT_URI = "https://vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": process.env.FRONTEND_ORIGIN || DEFAULT_REDIRECT_URI,
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function githubTokenHandler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed", message: "Use POST." });
    return;
  }

  if (!process.env.GITHUB_CLIENT_SECRET) {
    sendJson(res, 500, {
      error: "server_misconfigured",
      message: "Missing GITHUB_CLIENT_SECRET environment variable.",
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: "invalid_json", message: "Request body must be valid JSON." });
    return;
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    sendJson(res, 400, { error: "missing_code", message: "Missing GitHub authorization code." });
    return;
  }

  try {
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Aura-Vercel-OAuth",
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: body.redirect_uri || process.env.GITHUB_REDIRECT_URI || DEFAULT_REDIRECT_URI,
      }),
    });

    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || tokenPayload.error || !tokenPayload.access_token) {
      sendJson(res, 400, {
        error: tokenPayload.error || "github_token_exchange_failed",
        message: tokenPayload.error_description || "GitHub rejected the authorization code.",
      });
      return;
    }

    const userResponse = await fetch(GITHUB_USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${tokenPayload.access_token}`,
        "User-Agent": "Aura-Vercel-OAuth",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const githubUser = await userResponse.json();

    let primaryEmail = githubUser.email || null;
    try {
      const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokenPayload.access_token}`,
          "User-Agent": "Aura-Vercel-OAuth",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (emailsResponse.ok) {
        const emails = await emailsResponse.json();
        const primary = Array.isArray(emails)
          ? emails.find((email) => email.primary && email.verified) || emails.find((email) => email.verified)
          : null;
        primaryEmail = primary?.email || primaryEmail;
      }
    } catch {
      // A missing email should not fail the OAuth login.
    }

    sendJson(res, 200, {
      access_token: tokenPayload.access_token,
      token_type: tokenPayload.token_type,
      scope: tokenPayload.scope,
      user: {
        id: githubUser.id,
        login: githubUser.login,
        name: githubUser.name || githubUser.login,
        email: primaryEmail,
        avatar_url: githubUser.avatar_url,
        html_url: githubUser.html_url,
      },
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "github_oauth_unavailable",
      message: error instanceof Error ? error.message : "Unable to reach GitHub OAuth.",
    });
  }
};
