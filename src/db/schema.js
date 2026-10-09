import "../config/env.js";
import { sql } from "./dbClient.js";

async function createSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL,
      city VARCHAR(100),
      country VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  console.log("Schema created successfully");

  await sql.end();
}

createSchema().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
