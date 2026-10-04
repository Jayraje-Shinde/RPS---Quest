import express from 'express'
import "./config/env.js";
import { writeBuffer, getValue, setKV, delKey} from "./redis/redis.js";
import { sql } from "./db/dbClient.js";

try {
  await sql`SELECT 1`;
  console.log("Connected to the database");
} catch (error) {
  console.error("Failed to connect to the database", error);
}


const app = express()

app.use(express.json());


app.get('/', (req, res) => {
   console.log("Request received");
  res.send('Hello World')
})

app.get('/customers/:id', async (req, res) => {

  const customer = JSON.parse(await getValue(`customer:${req.params.id}`));

  if(customer) {
    return res.json(customer);
  } else {
    const customers =
      await sql`SELECT * FROM customers where id=${req.params.id}`;
    res.json(customers);

    setKV(`customer:${req.params.id}`, customers, 300);
  }

});

app.post('/customers', async (req, res) => {
  const { name, email, city, country } = req.body;

  const id = await writeBuffer("CREATE_USER", { name, email, city, country });

  res.status(201).json({
    message: "Customer queue for creation",
    id,
  });
});

app.put('/customers/:id', async(req, res) => {
  const { name, email, city, country } = req.body;
  await sql`UPDATE customers SET name=${name}, email=${email}, city=${city}, country=${country} WHERE id=${req.params.id}`;
  await delKey(`customer:${req.params.id}`);
  res.send('Customer updated');
});

app.delete('/customers/:id', async (req, res) => {
  await sql`DELETE FROM customers WHERE id=${req.params.id}`;
  res.send('Customer deleted');
});


app.listen(process.env.APP_PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.APP_PORT}`)
})
