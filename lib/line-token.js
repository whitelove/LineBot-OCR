import { AppError } from "./errors.js";

// Each server instance keeps its own short-lived token and shares in-flight issuance.
export function createStatelessTokenProvider({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let cached = null;
  let pending = null;

  async function issue() {
    if (!env.LINE_CHANNEL_ID || !env.LINE_CHANNEL_SECRET)
      throw new AppError("ยังไม่ได้ตั้งค่า LINE_CHANNEL_ID / LINE_CHANNEL_SECRET", 503);
    const started = now();
    let response;
    try {
      response = await fetchImpl("https://api.line.me/oauth2/v3/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: env.LINE_CHANNEL_ID,
          client_secret: env.LINE_CHANNEL_SECRET,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Token issuance failed");
      }
      const data = await response.json();
      if (typeof data.access_token !== "string" || !data.access_token ||
          !Number.isFinite(data.expires_in) || data.expires_in <= 60)
        throw new Error("Invalid token response");
      cached = { value: data.access_token, expiresAt: started + (data.expires_in - 60) * 1000 };
      return cached.value;
    } catch {
      // Never include LINE's response body or credentials in errors/logs.
      throw new AppError("ออก LINE stateless access token ไม่สำเร็จ", 502, "LINE_TOKEN");
    }
  }

  async function getToken() {
    if (cached && now() < cached.expiresAt) return cached.value;
    if (!pending) pending = issue().finally(() => { pending = null; });
    return pending;
  }
  getToken.invalidate = (value) => {
    if (cached?.value === value) cached = null;
  };
  return getToken;
}
