import { sql } from "./dbClient.js";

async function createSchema() {
  await sql`
    CREATE TABLE customers (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      city VARCHAR(100),
      country VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE products (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      category VARCHAR(100) NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      stock INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE orders (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      customer_id BIGINT NOT NULL,
      status VARCHAR(30) NOT NULL,
      total_amount DECIMAL(12, 2) NOT NULL,
      order_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (customer_id)
        REFERENCES customers(id)
    )
  `;

  await sql`
    CREATE TABLE order_items (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id BIGINT NOT NULL,
      product_id BIGINT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price DECIMAL(10, 2) NOT NULL,

      FOREIGN KEY (order_id)
        REFERENCES orders(id),

      FOREIGN KEY (product_id)
        REFERENCES products(id)
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
