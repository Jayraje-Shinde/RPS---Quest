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

if(sql) {
  console.log('Database connected');
}

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
