import cpeak from "cpeak";
import dotenv from 'dotenv'
dotenv.config();

import { sql } from "./db/dbClient.js";

const server = cpeak();

server.route("get", "/", (req, res) => {
  return res.json({ message: "Hi there!" });
});
sql;


server.listen(3000, () => {
  console.log("Server has started on port 3000");
});
