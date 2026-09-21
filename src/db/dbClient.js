import postgres from "postgres";
import dotenv from 'dotenv'
dotenv.config();

const sql = postgres({
  host: "process.env.DB_HOST",
  port: "process.env.DB_PORT",
  user: "process.env.DB_USER",
  password: "process.env.DB_PASSWORD",
  database: "process.env.DB_NAME"
});

try {
  await sql`SELECT 1`;
  console.log("Connected to the database");
} catch (error) {
  console.error("Failed to connect to the database", error);
}

export { sql };
