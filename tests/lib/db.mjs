// Creates a fresh Postgres database with the Supabase stand-in and Worm's
// migrations applied, and calls functions the same way Supabase's API does:
// inside a transaction, as the caller's role, with their sign-in claims set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const ADMIN_URL = process.env.PG_ADMIN_URL || "postgres://postgres:postgres@localhost:5432/postgres";

export async function freshDatabase(name = "worm_test") {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, "/" + name);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(here, "..", "supabase-stub.sql"), "utf8"));
    const dir = path.join(root, "supabase", "migrations");
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.includes("schedule")) continue; // pg_cron isn't installed locally; tests call worm_tick() directly
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
    }
  } finally {
    await client.end();
  }
  return url;
}

export function pool(url) {
  return new pg.Pool({ connectionString: url, max: 10 });
}

// who: "anon", "service", or a user id
export async function rpc(db, who, fn, args = {}) {
  const client = await db.connect();
  try {
    await client.query("begin");
    if (who === "anon") {
      await client.query("set local role anon");
    } else if (who === "service") {
      await client.query("set local role service_role");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    } else {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated" })]);
    }
    const names = Object.keys(args);
    const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
    const res = await client.query(sql, names.map((n) => args[n]));
    await client.query("commit");
    return res.rows[0].r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Runs raw SQL as a given role (used to prove direct table access is blocked).
export async function asRole(db, who, sql, params = []) {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${who === "anon" ? "anon" : "authenticated"}`);
    if (who !== "anon") await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated" })]);
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
