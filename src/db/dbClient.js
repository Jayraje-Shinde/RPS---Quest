import postgres from "postgres";

export default sql = postgres.createClient({
  host: "localhost",
  port: 5432,
  user: "scaler",
  password: "123",
  database: "scaledb"
});
