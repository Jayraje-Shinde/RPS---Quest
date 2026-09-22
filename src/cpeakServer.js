import cpeak from "cpeak";
import "./config/env.js";

import { sql } from "./db/dbClient.js";

try {
  await sql`SELECT 1`;
  console.log("Connected to the database");
} catch (error) {
  console.error("Failed to connect to the database", error);
}


const server = cpeak();

server.route("get", "/", (req, res) => {
  return res.json({ message: "Hi there!" });
});


server.route("get", '/customers', async (req, res) => {
  const customers = await sql`SELECT * FROM customers`;
  res.json(customers);
});



server.listen(3000, () => {
  console.log("Server has started on port 3000");
});
