import { createClient } from "redis";

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});

await redisClient.connect();
console.log("Connected to Redis");

async function ensureConsumerGroup(streamName, groupName) {
  try {
    await redisClient.xGroupCreate(streamName, groupName, "$", { MKSTREAM: true });
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
  await redisClient.set(key, value, { expiration: exp });
}

async function getValue(key) {
  return await redisClient.get(key);
}

async function delKey(key) {
  await redisClient.del(key);
}

async function writeBuffer(operation, payload) {

  const id = await redisClient.xAdd("dbStream", "*", {
    operation,
    payload: JSON.stringify(payload),
  });

  if (!id) throw new Error("Failed to write to buffer");

  return id;
}

async function ackHelper(messageIds) {
  if (messageIds.length === 0) return;

  await redisClient.xAck("dbStream", "db-writer", messageIds);
}

async function readBuffer(streamName) {
  const result = await redisClient.xReadGroup(
    "db-writer",
    "worker-1",
    {
      key: streamName,
      id: ">",
    },
    {
      COUNT: 100,
      BLOCK: 10_000,
    },
  );

  if (!result) return null;

  return result;
}

export {
  redisClient,
  setKV,
  getValue,
  delKey,
  writeBuffer,
  ackHelper,
  readBuffer,
  ensureConsumerGroup
};
