import express from 'express'
import dotenv from 'dotenv'
dotenv.config();

import { sql } from "./db/dbClient.js";

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
