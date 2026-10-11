import "../config/env.js";
import postgres from "postgres";

const sql = postgres({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: Number(process.env.DB_MAX_CONNECTIONS ?? 10),
});

export { sql };
