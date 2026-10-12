import "../config/env.js";
import { sql } from "./dbClient.js";

async function seed() {
  await sql`TRUNCATE TABLE customers`;

  for (let i = 0; i < 1000000; i++) {
    await sql`insert into customers (name, email, city, country) values ('person${i}', 'person${i}@rpsquest.org', 'Person${i} city', 'Person${i} Country');`;
  }
  console.log(await sql`select count(*) from customers`);
}

seed();
