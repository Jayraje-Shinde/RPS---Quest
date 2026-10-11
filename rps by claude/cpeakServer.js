import cpeak, { parseJSON } from "cpeak";
import "./config/env.js";
import { trackRequests } from "./lib/logger.js";
import { sql } from "./db/dbClient.js";
import { getValue, setKV, delKey, writeBuffer } from "./redis/redis.js";

const PORT = Number(process.env.APP_PORT ?? 3000);
const CACHE_TTL = Number(process.env.CACHE_TTL ?? 300); // seconds; the safety net if an invalidation is ever missed
const EMPTY_TTL = 30;                                   // "not found" is cached briefly: a new row may appear with that id

const ID_RE = /^\d{1,18}$/;
const LIMITS = { name: 100, email: 150, city: 100, country: 100 }; // mirrors the VARCHAR sizes in schema.js

// A failure in a background task must never take the whole server down.
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));

try {
  await sql`SELECT 1`;
  console.log("Connected to the database");
} catch (error) {
  console.error("Failed to connect to the database", error);
}

// Returns { c } with a clean customer object, or { error } describing what is wrong.
function validateCustomer(body) {
  const b = body ?? {};
  if (typeof b.name !== "string" || !b.name) return { error: "name is required" };
  if (typeof b.email !== "string" || !b.email) return { error: "email is required" };
  const c = {
    name: b.name,
    email: b.email,
    city: b.city == null ? null : String(b.city),
    country: b.country == null ? null : String(b.country),
  };
  for (const [field, max] of Object.entries(LIMITS)) {
    if (c[field] != null && c[field].length > max) return { error: `${field} must be at most ${max} characters` };
  }
  return { c };
}

// One place for error handling, so no route can leave a request hanging after a throw.
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(`${req.method} ${req.url} failed:`, err);
    if (!res.headersSent) res.status(500).json({ message: "Internal server error" });
  }
};

// Send a pre-serialized JSON string without parsing and re-stringifying it.
function sendJSONString(res, body) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(body);
}

const server = cpeak({ compression: process.env.COMPRESSION === "1" }); // off by default: gzip burns event-loop CPU
server.beforeEach(trackRequests);
server.beforeEach(parseJSON({ limit: 1024 * 1024 }));

server.route("get", "/", (req, res) => res.json({ message: "Hi there!" }));

// ---- READ, no cache (baseline) ----
server.route("get", "/customers/v1/:id", handle(async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ message: "invalid id" });
  const rows = await sql`SELECT * FROM customers WHERE id = ${id}`;
  return res.json(rows);
}));

// ---- READ, cache-aside through Redis ----
server.route("get", "/customers/v2/:id", handle(async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ message: "invalid id" });
  const key = `customer:${id}`;

  let cached = null;
  try {
    cached = await getValue(key);
  } catch (err) {
    console.error("cache read failed, falling back to DB:", err.message); // Redis down must not mean API down
  }
  if (cached !== null) return sendJSONString(res, cached);

  const rows = await sql`SELECT * FROM customers WHERE id = ${id}`;
  const body = JSON.stringify(rows);
  sendJSONString(res, body);

  // Fire-and-forget AFTER responding. The .catch is what actually handles a Redis failure
  // (try/catch cannot, because the rejection happens after the try block has finished).
  setKV(key, body, rows.length ? CACHE_TTL : EMPTY_TTL).catch((err) =>
    console.error("cache write failed:", err.message),
  );
}));

// ---- CREATE, direct insert (baseline) ----
server.route("post", "/customers/v1", handle(async (req, res) => {
  const { c, error } = validateCustomer(req.body);
  if (error) return res.status(400).json({ message: error });
  const [row] = await sql`
    INSERT INTO customers (name, email, city, country)
    VALUES (${c.name}, ${c.email}, ${c.city}, ${c.country})
    RETURNING id`;
  return res.status(201).json({ message: "Customer created", id: row.id });
}));

// ---- CREATE, queued through the Redis stream ----
server.route("post", "/customers/v2", handle(async (req, res) => {
  const { c, error } = validateCustomer(req.body); // reject bad data here so it never enters the queue
  if (error) return res.status(400).json({ message: error });
  const id = await writeBuffer("CREATE_USER", c);
  return res.status(202).json({ message: "Customer queued for creation", id });
}));

// ---- UPDATE ----
server.route("put", "/customers/:id", handle(async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ message: "invalid id" });
  const { c, error } = validateCustomer(req.body);
  if (error) return res.status(400).json({ message: error });

  const rows = await sql`
    UPDATE customers SET name = ${c.name}, email = ${c.email}, city = ${c.city}, country = ${c.country}
    WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) return res.status(404).json({ message: "not found" });

  await delKey(`customer:${id}`).catch((err) => console.error("cache invalidate failed:", err.message)); // after the DB commit
  return res.json({ message: "Customer updated" });
}));

// ---- DELETE ----
server.route("delete", "/customers/v1/:id", handle(async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return res.status(400).json({ message: "invalid id" });

  const rows = await sql`DELETE FROM customers WHERE id = ${id} RETURNING id`;
  if (rows.length === 0) return res.status(404).json({ message: "not found" });

  await delKey(`customer:${id}`).catch((err) => console.error("cache invalidate failed:", err.message));
  return res.json({ message: "Customer deleted" });
}));

server.listen(PORT, () => console.log(`Server has started on port ${PORT}`));
