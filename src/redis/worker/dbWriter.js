import { sql } from "../../db/dbClient.js";
import "../../config/env.js"

import {  readBuffer, ackHelper, ensureConsumerGroup} from "../redis.js";
import { parseJSON } from "cpeak";


const BATCH_SIZE = Number(process.env.BATCHING_SIZE ?? 1000);
const BATCHING_TIMEOUT = Number(
  process.env.BATCHING_TIMEOUT ?? 10_000
);


const batch = [];
let batchTimer = null;


await ensureConsumerGroup("dbStream", "db-writer");

async function flushBatch() {
  if (batch.length === 0) return;

  const msgs = batch.splice(0, batch.length);

  await write2DB(msgs);

  const messageids = msgs.map((msg) => msg.id);

  await ackHelper(messageids);
}

async function write2DB(msgs) {
  const rows = [];
  for (const m of msgs) {
    if (m.message.operation !== "CREATE_USER") continue;
    let p;
    try { p = JSON.parse(m.message.payload); }
    catch { console.error("bad json", m.id); continue; }
    if (!p.name || !p.email) { console.error("invalid payload", m.id, p); continue; }
    rows.push({ name: p.name, email: p.email, city: p.city ?? null, country: p.country ?? null });
  }
  if (rows.length === 0) return;

  for (const m of msgs) {

    const payload = JSON.parse(m.message.payload)
    const { name, email, city, country } = payload;
    await sql`INSERT INTO CUSTOMERS(name, email,city,country) VALUES(${name}, ${email}, ${city}, ${country})`
     }
}


while (true) {
  const result = await readBuffer("dbStream");

  if (!result) continue;

  const msgs = result[0].messages;

  if (batch.length === 0) {
    batchTimer = setTimeout(() => {
      batchTimer = null;
      flushBatch().catch(console.error);
    }, BATCHING_TIMEOUT)
  }

  batch.push(...msgs);

  if (batch.length >= BATCH_SIZE) {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null;
    }
    await flushBatch();

  }



}
