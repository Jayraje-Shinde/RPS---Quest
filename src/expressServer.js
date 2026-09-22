import express from 'express'
import "./config/env.js";

import { sql } from "./db/dbClient.js";

try {
  await sql`SELECT 1`;
  console.log("Connected to the database");
} catch (error) {
  console.error("Failed to connect to the database", error);
}


const app = express()

app.get('/', (req, res) => {
  res.send('Hello World')
})

app.get('/customers', async (req, res) => {
  const customers = await sql`SELECT * FROM customers`;
  res.json(customers);
});


app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
