import { sql } from "../../db/dbClient.js";


import {  readBuffer, ackHelper, ensureConsumerGroup} from "../redis.js";


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

  const users = msgs
    .filter((msg) => msg.message.operation === "CREATE_USER")
    .map((msg) => JSON.parse(msg.message.payload));
  console.log("Inserting ", users.length, users[0])
  if (users.length === 0) {
    return;
  }

  await sql`INSERT INTO customers (name, email, city, country) VALUES ${sql(users, "name", "email", "city", "country")}`;
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
