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
   console.log("Request received");
  res.send('Hello World')
})

app.get('/customers', async (req, res) => {
  const customers = await sql`SELECT * FROM customers`;
  res.json(customers);
});

app.post('/customers', async (req, res) => {
  const { name, email, city, country } = req.body;
  await sql`INSERT INTO customers (name, email, city, country) VALUES (${name}, ${email}, ${city}, ${country})`;
  res.send('Customer added');
});

app.put('/customers/:id', async(req, res) => {
  const { name, email, city, country } = req.body;
  await sql`UPDATE customers SET name=${name}, email=${email}, city=${city}, country=${country} WHERE id=${req.params.id}`;
  res.send('Customer updated');
});

app.delete('/customers/:id', async (req, res) => {
  await sql`DELETE FROM customers WHERE id=${req.params.id}`;
  res.send('Customer deleted');
});


app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000')
})
