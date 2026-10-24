import test, { after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rm, stat } from "node:fs/promises";

const tokenFile = path.join(os.tmpdir(), `maimen-live-token-${Date.now()}.json`);
process.env.LIVE_TOKEN_FILE = tokenFile;

const config = await import("../lib/live-config.js");

after(async () => {
  await rm(tokenFile, { force: true });
});

test("accepts a well-formed opaque token", () => {
  const result = config.normalizeToken("  eyJhbGciOiJIUzI1NiJ9.abc-DEF_123.xyz=  ");
  assert.equal(result.ok, true);
  assert.equal(result.token, "eyJhbGciOiJIUzI1NiJ9.abc-DEF_123.xyz=");
});

test("rejects missing, short and oversized tokens", () => {
  assert.equal(config.normalizeToken(undefined).code, "TOKEN_MISSING");
  assert.equal(config.normalizeToken("   ").code, "TOKEN_MISSING");
  assert.equal(config.normalizeToken("abc").code, "TOKEN_TOO_SHORT");
  assert.equal(config.normalizeToken("a".repeat(513)).code, "TOKEN_TOO_LONG");
});

test("rejects tokens with whitespace or unsupported characters", () => {
  assert.equal(config.normalizeToken("abcdefgh ijklmnop").code, "TOKEN_FORMAT");
  assert.equal(config.normalizeToken("abcdefgh\nijklmnop").code, "TOKEN_FORMAT");
  assert.equal(config.normalizeToken("abcdefgh$ijklmnop").code, "TOKEN_FORMAT");
});

test("classifies connect failures into friendly codes", () => {
  assert.equal(config.classifyConnectError(new Error("HTTP 401 Unauthorized")).code, "INVALID_TOKEN");
  const authError = new Error("Streamable HTTP error: Error POSTing to endpoint: 当前鉴权码不存在或已失效!");
  authError.code = 401;
  assert.equal(config.classifyConnectError(authError).code, "INVALID_TOKEN");
  assert.equal(config.classifyConnectError(new Error("工具调用超时")).code, "TIMEOUT");
  assert.equal(config.classifyConnectError(new Error("getaddrinfo ENOTFOUND mcp.mcd.cn")).code, "NETWORK");
  assert.equal(config.classifyConnectError(new Error("boom")).code, "CONNECT_FAILED");
});

test("stores and clears the token without exposing it elsewhere", async () => {
  await config.saveStoredToken("token-1234567890");
  const loaded = await config.loadStoredToken();
  assert.equal(loaded.token, "token-1234567890");
  assert.ok(loaded.savedAt);
  const info = await stat(tokenFile);
  assert.ok(info.size > 0);

  await config.clearStoredToken();
  assert.equal(await config.loadStoredToken(), null);
});

test("refuses to persist an invalid token", async () => {
  await assert.rejects(() => config.saveStoredToken("short"), /Token 太短/);
});
