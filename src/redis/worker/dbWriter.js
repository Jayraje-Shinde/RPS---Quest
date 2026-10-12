import "../../config/env.js";
import { sql } from "../../db/dbClient.js";
import {
  readBuffer,
  ackHelper,
  claimStale,
  deadLetter,
  ensureConsumerGroup,
} from "../redis.js";

const BATCH_SIZE = Number(process.env.BATCHING_SIZE ?? 1000);
const BATCHING_TIMEOUT = Number(process.env.BATCHING_TIMEOUT ?? 10_000);
const POLL_BLOCK_MS = Math.min(1000, BATCHING_TIMEOUT);
const INSERT_OPERATION = "CREATE_USER";
const MAX_ROWS_PER_INSERT = 5000;
const MIN_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = true;

//for shutting down a worker
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down...`);
    running = false;
  });
}

async function write2DB(rows) {
  if (rows.length === 0) return;

  await sql.begin(async (tx) => {
    for (let i = 0; i < rows.length; i += MAX_ROWS_PER_INSERT) {
      const chunk = rows.slice(i, i + MAX_ROWS_PER_INSERT);
          await tx`
        INSERT INTO customers ${tx(chunk, "name", "email", "city", "country")}
        ON CONFLICT (email) DO NOTHING
      `;
    }
  });
}


//Turn raw stream entries into rows, write them, then ack.
async function processEntries(entries) {
  const rows = [];
  const idsToAck = [];

  for (const entry of entries) {

    if (!entry.message) {
      idsToAck.push(entry.id);
      continue;
    }

    // Poison messages (can never succeed) go to the dead-letter stream and are acked,
    // otherwise they would be retried forever and block everything behind them.
    let payload;
    try {
      payload = JSON.parse(entry.message.payload);
    } catch {
      await deadLetter(entry, "invalid JSON payload");
      idsToAck.push(entry.id);
      continue;
    }

    if (entry.message.operation !== INSERT_OPERATION) {
      await deadLetter(entry, `unsupported operation: ${entry.message.operation}`);
      idsToAck.push(entry.id);
      continue;
    }

    rows.push({
      name: payload.name,
      email: payload.email,
      city: payload.city,
      country: payload.country,
    });
    idsToAck.push(entry.id);
  }

  await write2DB(rows); // if this throws we never reach the ack below
  await ackHelper(idsToAck); // ack ONLY after the DB commit succeeded
}

async function main() {
  await ensureConsumerGroup("dbStream", "db-writer");

  let batch = [];
  let batchStartedAt = 0;
  let recovering = true;
  let retryDelay = MIN_RETRY_DELAY;

  while (running) {
    try {
      // retry pending (unacked) entries
      if (recovering) {
        // id "0" = "give me MY entries that were delivered but never acked"
        let entries = await readBuffer({ id: "0", count: BATCH_SIZE });

        if (entries.length === 0) entries = await claimStale(60_000, BATCH_SIZE);

        if (entries.length === 0) {
          recovering = false; // nothing left to recover, go to normal mode
          continue;
        }

        await processEntries(entries);
        retryDelay = MIN_RETRY_DELAY;
        continue; // loop again until the pending list is empty
      }

      // NORMAL MODE: read new entries and batch them
      const entries = await readBuffer({
        id: ">", // only never-delivered entries
        count: BATCH_SIZE - batch.length, // never overshoot the batch size
        block: POLL_BLOCK_MS, // wait up to 1s so we still check the timeout below
      });

      if (entries.length > 0) {
        if (batch.length === 0) batchStartedAt = Date.now();
        batch.push(...entries);
      }

      const isFull = batch.length >= BATCH_SIZE;
      const isExpired = batch.length > 0 && Date.now() - batchStartedAt >= BATCHING_TIMEOUT;

      if (isFull || isExpired) {
        const toWrite = batch;
        batch = []; // reset first so a throw below doesn't keep a stale batch
        await processEntries(toWrite);
        retryDelay = MIN_RETRY_DELAY;
      }
    } catch (err) {
      console.error(`Batch failed, retrying in ${retryDelay}ms:`, err.message);
      batch = [];
      recovering = true;
      await sleep(retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    }
  }

  console.log("Worker stopped.");
  process.exit(0); // close open Redis/Postgres connections
}

main().catch((err) => {
  console.error("Fatal worker error:", err);
  process.exit(1);
});
