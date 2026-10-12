import { createClient } from "redis";

// ---- constants shared with the worker (single source of truth) -------------
export const STREAM = "dbStream";
export const GROUP = "db-writer";
export const DEAD_STREAM = "dbStream:dead"; // where unprocessable entries go
export const CONSUMER = process.env.CONSUMER_NAME ?? "worker-1";

const STREAM_MAXLEN = Number(process.env.STREAM_MAXLEN ?? 1_000_000);

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT), // env vars are strings -> convert
  },
});


redisClient.on("error", (err) => console.error("Redis error:", err.message));

await redisClient.connect();
console.log("Connected to Redis");

async function ensureConsumerGroup(streamName = STREAM, groupName = GROUP) {
  try {
    await redisClient.xGroupCreate(streamName, groupName, "0", { MKSTREAM: true });
    console.log(`Created consumer group "${groupName}" on stream "${streamName}"`);
  } catch (err) {
    if (err.message.includes("BUSYGROUP")) {
      console.log(`Consumer group "${groupName}" already exists, continuing`);
    } else {
      throw err;
    }
  }
}

async function setKV(key, value, exp) {
  await redisClient.set(key, value, { EX: exp });
}

async function getValue(key) {
  return await redisClient.get(key);
}

async function delKey(key) {
  await redisClient.del(key);
}

/** Producer side: append one operation to the stream. */
async function writeBuffer(operation, payload) {
  const id = await redisClient.xAdd(
    STREAM,
    "*", // star generates random id based on time-sequence
    {
      operation,
      payload: JSON.stringify(payload),
    },
    {
      TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_MAXLEN },
    },
  );

  if (!id) throw new Error("Failed to write to buffer");
  return id;
}

async function ackHelper(messageIds, streamName = STREAM, groupName = GROUP) {
  if (messageIds.length === 0) return;

  await redisClient.xAck(streamName, groupName, messageIds);
  await redisClient.xDel(streamName, messageIds);
}

async function readBuffer({ id = ">", count = 100, block } = {}) {
  const options = { COUNT: count };
  // BLOCK is only meaningful with ">"; only add it when asked.
  if (id === ">" && block !== undefined) options.BLOCK = block;

  const result = await redisClient.xReadGroup(
    GROUP,
    CONSUMER,
    { key: STREAM, id },
    options,
  );

  // null = BLOCK timeout with no data
  if (!result) return [];

  // result = [{ name, messages: [{ id, message }] }] -> we only read one stream
  return result[0].messages;
}

async function claimStale(minIdleMs = 60_000, count = 100) {
  const res = await redisClient.xAutoClaim(STREAM, GROUP, CONSUMER, minIdleMs, "0-0", {
    COUNT: count,
  });
  return res.messages;
}

async function deadLetter(entry, reason) {
    await redisClient.xAdd(DEAD_STREAM, "*", {
      originalId: entry.id,
      reason,
      raw: JSON.stringify(entry.message ?? null),
    });
}

export {
  redisClient,
  setKV,
  getValue,
  delKey,
  writeBuffer,
  ackHelper,
  readBuffer,
  claimStale,
  deadLetter,
  ensureConsumerGroup,
};
