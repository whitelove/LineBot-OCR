import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createStatelessTokenProvider } from "../lib/line-token.js";
import { createLineClient } from "../lib/line.js";
import { createWebhookHandler } from "../lib/webhook.js";

const env = { LINE_CHANNEL_ID: "123", LINE_CHANNEL_SECRET: "secret" };

test("stateless exchange uses credentials, shares concurrent issuance and refreshes before expiry", async () => {
  let clock = 0, calls = 0;
  const getToken = createStatelessTokenProvider({
    env,
    now: () => clock,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://api.line.me/oauth2/v3/token");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.deepEqual(Object.fromEntries(options.body), {
        grant_type: "client_credentials", client_id: "123", client_secret: "secret",
      });
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ access_token: `token-${calls}`, expires_in: 900 });
    },
  });
  assert.deepEqual(await Promise.all([getToken(), getToken(), getToken()]), ["token-1", "token-1", "token-1"]);
  clock = 839_999;
  assert.equal(await getToken(), "token-1");
  clock = 840_000;
  assert.equal(await getToken(), "token-2");
  assert.equal(calls, 2);
});

test("failed issuance clears pending state, hides secrets and can be retried", async () => {
  let calls = 0;
  const getToken = createStatelessTokenProvider({ env, fetchImpl: async () => {
    if (++calls === 1) return new Response("sensitive secret", { status: 401 });
    return Response.json({ access_token: "recovered", expires_in: 900 });
  } });
  await assert.rejects(getToken(), (error) => error.code === "LINE_TOKEN" && !error.message.includes("secret"));
  assert.equal(await getToken(), "recovered");
});

test("missing channel credentials cannot fall back to a long-lived token", async () => {
  const getToken = createStatelessTokenProvider({
    env: { LINE_CHANNEL_SECRET: "secret", LINE_CHANNEL_ACCESS_TOKEN: "legacy" },
    fetchImpl: () => assert.fail("must not request token without ID"),
  });
  await assert.rejects(getToken(), (error) => error.status === 503);
});

for (const data of [{}, { access_token: "x", expires_in: 0 }, { access_token: "", expires_in: 900 }])
  test(`invalid token response rejected: ${JSON.stringify(data)}`, async () => {
    const getToken = createStatelessTokenProvider({ env, fetchImpl: async () => Response.json(data) });
    await assert.rejects(getToken(), (error) => error.code === "LINE_TOKEN");
  });

test("401 invalidates cached token without replaying a reply", async () => {
  let issued = 0, replies = 0;
  const getToken = createStatelessTokenProvider({ env, fetchImpl: async () =>
    Response.json({ access_token: `token-${++issued}`, expires_in: 900 }),
  });
  const line = createLineClient(getToken, async (_url, options) => {
    replies++;
    assert.equal(options.headers.Authorization, `Bearer token-${issued}`);
    return new Response("{}", { status: replies === 1 ? 401 : 200 });
  });
  await assert.rejects(line.reply("r1", "hello"), /LINE/);
  assert.equal(replies, 1);
  await line.reply("r2", "hello");
  assert.equal(issued, 2);
});

test("signed webhook issues a stateless token and uses it for reply", async () => {
  const calls = [];
  const post = createWebhookHandler({ env, fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.endsWith("/oauth2/v3/token"))
      return Response.json({ access_token: "stateless", expires_in: 900 });
    assert.equal(options.headers.Authorization, "Bearer stateless");
    return Response.json({});
  } });
  const body = JSON.stringify({ events: [{ type: "message", replyToken: "reply", message: { type: "text" } }] });
  const response = await post(new Request("https://example.com/api/webhook", {
    method: "POST", body,
    headers: { "x-line-signature": createHmac("sha256", env.LINE_CHANNEL_SECRET).update(body).digest("base64") },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["https://api.line.me/oauth2/v3/token", "https://api.line.me/v2/bot/message/reply"]);
});
