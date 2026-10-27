// A small local stand-in for a Supabase project's web API, backed by the real
// test database. It speaks the same HTTP the supabase-js library and Worm's
// edge functions use: database functions (/rest/v1/rpc), sign-in user lookup
// (/auth/v1), photo storage (/storage/v1) and edge functions (/functions/v1).
// Sign-in tokens are real signed JWTs, checked the same way Supabase checks them.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { rpc } from "./db.mjs";

export const JWT_SECRET = "worm-test-jwt-secret-at-least-32-characters";
const b64url = (b) => Buffer.from(b).toString("base64url");

export function signJwt(payload, secret = JWT_SECRET) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...payload }));
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token) {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!sig) return null;
  const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

export const ANON_KEY = signJwt({ role: "anon" });
export const SERVICE_KEY = signJwt({ role: "service_role" });
export const userToken = (id, email = `${id.slice(0, 6)}@example.com`) =>
  signJwt({ sub: id, role: "authenticated", aud: "authenticated", email });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png" };

export function startMock({ db, port = 54321, functionsUrl = null, staticRoot = null, configJs = null, fakeFunctions = {} }) {
  const files = new Map(); // storage objects: "avatars/<path>" -> { type, body }
  const callers = (req) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    return verifyJwt(bearer) ?? verifyJwt(req.headers.apikey);
  };
  const send = (res, status, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    res.writeHead(status, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-upsert, content-profile, accept-profile, prefer",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      ...(isBuf ? {} : { "Content-Type": "application/json" }),
      ...headers,
    });
    res.end(isBuf ? body : body === undefined ? "" : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;
    if (req.method === "OPTIONS") return send(res, 200, "ok");
    try {
      // ---- database functions
      const rpcMatch = p.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (rpcMatch) {
        const claims = callers(req);
        if (!claims) return send(res, 401, { message: "Invalid JWT" });
        const who = claims.role === "service_role" ? "service" : claims.role === "authenticated" ? claims.sub : "anon";
        const raw = (await readBody(req)).toString();
        const args = raw ? JSON.parse(raw) : {};
        const named = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, v]));
        try {
          const result = await rpc(db, who, rpcMatch[1], named);
          return send(res, 200, result ?? null);
        } catch (e) {
          const status = e.code === "42501" ? 403 : e.code === "42883" ? 404 : 400;
          return send(res, status, { code: e.code, message: e.message, details: null, hint: null });
        }
      }

      // ---- sign-in
      if (p === "/auth/v1/user" && req.method === "GET") {
        const claims = callers(req);
        if (!claims?.sub) return send(res, 401, { code: 401, msg: "Invalid token" });
        const exists = (await db.query("select id, email from auth.users where id = $1", [claims.sub])).rows[0];
        if (!exists) return send(res, 404, { code: 404, msg: "User not found" });
        return send(res, 200, { id: claims.sub, aud: "authenticated", role: "authenticated", email: exists.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
      }
      if (p === "/auth/v1/logout") return send(res, 204);
      const delUser = p.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
      if (delUser && req.method === "DELETE") {
        if (callers(req)?.role !== "service_role") return send(res, 403, { msg: "Not allowed" });
        await db.query("delete from auth.users where id = $1", [delUser[1]]);
        return send(res, 200, {});
      }

      // ---- photo storage, with the same "only your own folder" rule as the migration
      const pub = p.match(/^\/storage\/v1\/object\/public\/(.+)$/);
      if (pub && req.method === "GET") {
        const f = files.get(decodeURIComponent(pub[1]));
        return f ? send(res, 200, f.body, { "Content-Type": f.type }) : send(res, 404, { message: "Not found" });
      }
      const list = p.match(/^\/storage\/v1\/object\/list\/([a-z]+)$/);
      if (list && req.method === "POST") {
        const { prefix = "" } = JSON.parse((await readBody(req)).toString() || "{}");
        const out = [...files.keys()].filter((k) => k.startsWith(`${list[1]}/${prefix}/`)).map((k) => ({ name: k.split("/").pop() }));
        return send(res, 200, out);
      }
      const obj = p.match(/^\/storage\/v1\/object\/([a-z]+)\/?(.*)$/);
      if (obj) {
        const claims = callers(req);
        const bucket = obj[1];
        if (req.method === "DELETE") {
          if (claims?.role !== "service_role") return send(res, 403, { message: "Not allowed" });
          const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
          for (const k of prefixes) files.delete(`${bucket}/${k}`);
          return send(res, 200, prefixes.map((name) => ({ name })));
        }
        if (req.method === "POST" || req.method === "PUT") {
          const objectPath = decodeURIComponent(obj[2]);
          if (!claims?.sub || objectPath.split("/")[0] !== claims.sub) return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
          const body = await readBody(req);
          if (body.length > 2 * 1024 * 1024) return send(res, 413, { message: "Payload too large" });
          files.set(`${bucket}/${objectPath}`, { type: req.headers["content-type"] ?? "application/octet-stream", body });
          return send(res, 200, { Key: `${bucket}/${objectPath}`, Id: crypto.randomUUID() });
        }
      }

      // ---- edge functions (the real ones, via the Deno router, unless a test swaps one out)
      const fn = p.match(/^\/functions\/v1\/([a-z-]+)$/);
      if (fn) {
        const name = fn[1];
        const webhook = name.endsWith("-webhook");
        if (!webhook && !callers(req)) return send(res, 401, { msg: "Invalid JWT" });
        const body = await readBody(req);
        if (fakeFunctions[name]) {
          const out = await fakeFunctions[name]({ claims: callers(req), body: body.length ? JSON.parse(body.toString()) : {} });
          return send(res, out.status ?? 200, out.body);
        }
        if (!functionsUrl) return send(res, 404, { error: "No functions server" });
        const forwarded = await fetch(`${functionsUrl}/${name}`, {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "content-length", "connection"].includes(k))),
          body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
        });
        const text = Buffer.from(await forwarded.arrayBuffer());
        res.writeHead(forwarded.status, { "Access-Control-Allow-Origin": "*", "Content-Type": forwarded.headers.get("content-type") ?? "application/json" });
        return res.end(text);
      }

      // ---- the app itself
      if (staticRoot && req.method === "GET") {
        if (p === "/config.js" && configJs) return send(res, 200, Buffer.from(configJs), { "Content-Type": "text/javascript" });
        const file = path.join(staticRoot, p === "/" ? "index.html" : decodeURIComponent(p));
        if (file.startsWith(staticRoot) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          return send(res, 200, fs.readFileSync(file), { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
        }
      }
      return send(res, 404, { message: "Not found: " + p });
    } catch (e) {
      console.error("mock error", e);
      return send(res, 500, { message: String(e.message ?? e) });
    }
  });
  const close = () => {
    server.close();
    server.closeAllConnections();
  };
  return new Promise((resolve) => server.listen(port, () => resolve({ server, files, close, url: `http://localhost:${port}` })));
}
