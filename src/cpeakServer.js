import cpeak, { parseJSON } from "cpeak";
import "./config/env.js";
import { trackRequests, log } from "./lib/logger.js";
import { sql } from "./db/dbClient.js";
import { getValue, setKV, writeBuffer, delKey } from "./redis/redis.js";


//basic database connection check
try {
  await sql`SELECT 1`;
  console.log("Connected to the database");
} catch (error) {
  console.error("Failed to connect to the database", error);
}

const server = cpeak({ compression: true });
server.beforeEach(trackRequests);
server.beforeEach(parseJSON({ limit: 1024 * 1024 }));

server.route("get", "/", (req, res) => {
  return res.status(200).json({ message: "Hi there!" });
});

server.route("get", "/customers/v1/:id", async (req, res) => {
  try {

      const customers =
        await sql`SELECT * FROM customers where id=${req.params.id}`;

      res.status(200).json(customers);


    }
  catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

server.route("get", "/customers/v2/:id", async (req, res) => {
  try {
    const customer = JSON.parse(await getValue(`customer:${req.params.id}`));
    if (customer) {
      return res.status(200).json(customer);
    } else {
      const customers =
        await sql`SELECT * FROM customers where id=${req.params.id}`;

      res.status(200).json(customers);


      setKV(`customer:${req.params.id}`, JSON.stringify(customers), 300)
        .catch((err) => console.error("cache set failed:", err.message));
    }
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

server.route("post", "/customers/v1", async (req, res) => {
  const { name, email, city, country } = req.body;

  const id = await sql`INSERT INTO CUSTOMERS(name, email,city,country) VALUES(${name}, ${email}, ${city}, ${country}) RETURNING id`;

  res.status(201).json({
    id,
    message: "Customer Added"
  });
});

server.route("post", "/customers/v2", async (req, res) => {
  const { name, email, city, country } = req.body;

  const id = await writeBuffer("CREATE_USER", { name, email, city, country });

  res.status(202).json({
    message: "Customer queue for creation",
    id,
  });
});

server.route("put", "/customers/:id", async (req, res) => {
  const { name, email, city, country } = req.body;
  await sql`UPDATE customers SET name=${name}, email=${email}, city=${city}, country=${country} WHERE id=${req.params.id}`;

  await delKey(`customer:${req.params.id}`);

  res.status(200).send("Customer updated");
});

server.route("delete", "/customers/v1/:id", async (req, res) => {
  try {

  await sql`DELETE FROM customers WHERE id=${req.params.id}`;
  await delKey(`customer:${req.params.id}`);
  } catch (error) {
    return res.status(500).json({
      msg : "Failed to delete customer",
      error
    })
  }

  res.status(200).send("Customer deleted");

});

server.listen(process.env.APP_PORT, () => {
  console.log(`Server has started on port ${process.env.APP_PORT}`);
});
