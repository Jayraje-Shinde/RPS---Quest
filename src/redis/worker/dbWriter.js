import "../../config/env.js"; // must run before dbClient reads process.env
import { sql } from "../../db/dbClient.js";
import { readBuffer, ackHelper, deadLetter, ensureConsumerGroup } from "../redis.js";

const BATCH_SIZE = Number(process.env.BATCHING_SIZE ?? 500);       // max messages per read = max rows per INSERT
const MAX_WAIT_MS = Number(process.env.BATCHING_TIMEOUT ?? 1000);  // how long to wait for new messages
const CONSUMER = process.env.WORKER_NAME ?? "worker-1";            // run more workers with different names to scale out
const LIMITS = { name: 100, email: 150, city: 100, country: 100 }; // mirrors the VARCHAR sizes in schema.js

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Postgres error classes 22 (bad data) and 23 (constraint) can never succeed on retry.
// Everything else (connection loss, shutdown, timeouts) is transient and should be retried.
const isPoison = (err) => typeof err?.code === "string" && /^(22|23)/.test(err.code);

function parse(m) {
  if (m.message?.operation !== "CREATE_USER") return { reason: "unknown operation" };
  let p;
  try {
    p = JSON.parse(m.message.payload);
  } catch {
    return { reason: "bad json" };
  }
  if (!p || typeof p.name !== "string" || typeof p.email !== "string" || !p.name || !p.email) {
    return { reason: "missing name/email" };
  }
  const row = {
    name: p.name,
    email: p.email,
    city: p.city == null ? null : String(p.city),
    country: p.country == null ? null : String(p.country),
  };
  for (const [field, max] of Object.entries(LIMITS)) {
    if (row[field] != null && row[field].length > max) return { reason: `${field} too long` };
  }
  return { row };
}

const insertRows = (rows) =>
  sql`INSERT INTO customers ${sql(rows, "name", "email", "city", "country")}`; // NO "VALUES" and NO column list: the helper writes both

async function processBatch(msgs) {
  const done = []; // ids that are fully handled (inserted or dead-lettered) and safe to ack
  try {
    const good = [];
    for (const m of msgs) {
      const r = parse(m);
      if (r.row) good.push({ id: m.id, row: r.row });
      else {
        await deadLetter(m.id, m.message, r.reason);
        done.push(m.id);
      }
    }
    if (good.length === 0) return;

    try {
      await insertRows(good.map((g) => g.row)); // ONE statement, ONE commit, ONE fsync for the whole batch
      done.push(...good.map((g) => g.id));
    } catch (err) {
      if (!isPoison(err)) throw err; // transient: the statement was atomic, nothing was inserted, retry later
      // A bad row slipped through: isolate it so the other rows still land.
      for (const g of good) {
        try {
          await insertRows([g.row]);
          done.push(g.id);
        } catch (e) {
          if (!isPoison(e)) throw e;
          await deadLetter(g.id, { operation: "CREATE_USER", payload: JSON.stringify(g.row) }, e.message);
          done.push(g.id);
        }
      }
    }
  } finally {
    // Ack whatever was fully handled even if we are about to throw, so a retry cannot duplicate those rows.
    await ackHelper(done);
  }
}

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; });

await ensureConsumerGroup();
console.log(`worker "${CONSUMER}" started: batch=${BATCH_SIZE}, maxWait=${MAX_WAIT_MS}ms`);

let replay = true; // first, finish anything this consumer received but never acked in a previous run
let inserted = 0;
let lastReport = Date.now();

while (!stopping) {
  try {
    const msgs = await readBuffer({ consumer: CONSUMER, count: BATCH_SIZE, blockMs: MAX_WAIT_MS, pending: replay });
    if (replay && msgs.length === 0) {
      replay = false;
      console.log("pending replay finished");
      continue;
    }
    if (msgs.length === 0) continue; // nothing arrived within MAX_WAIT_MS

    await processBatch(msgs);
    inserted += msgs.length;
  } catch (err) {
    console.error("batch failed, will retry unacked messages in 1s:", err.message);
    replay = true; // unacked messages stay pending for this consumer; re-read them first
    await sleep(1000);
  }

  if (Date.now() - lastReport >= 5000) {
    console.log(`processed ${inserted} messages total`);
    lastReport = Date.now();
  }
}

await sql.end({ timeout: 5 });
process.exit(0);
