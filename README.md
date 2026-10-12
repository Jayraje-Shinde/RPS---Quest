# RPS---Quest

## Project Introduction

This project started as an experiment to understand how far a small server running on AWS can be pushed under heavy load. If possible, I also want to run the same tests on more powerful servers later and compare the results.

The main goal is to get a better understanding of database internals, caching, cache invalidation, and Redis-based queues by testing different approaches and measuring their actual performance.

## Scope

The project focuses on scaling read and write requests and identifying what works best under different conditions. Rather than building a feature-heavy application, the idea is to experiment with different architectures, compare their performance, and understand their trade-offs.

Some of the key things I plan to test are:

- Using Nginx and Redis for caching at different levels.
- Comparing different backend frameworks under load.
- Measuring performance when every read and write request directly hits the database.
- Using Redis Streams to process and batch multiple database operations.
- Testing whether Docker improves performance or provides any real benefits for an application running on a single server.

The testing will be done using **Autocannon** to generate high volumes of requests and push the server to its limits. The goal is not to simulate real-world users or production traffic patterns, but to find the server's performance ceiling, measure requests per second (RPS), identify bottlenecks, and understand how different optimizations affect overall throughput.

## Project overview

This is a Node.js performance and scaling experiment for a customer CRUD API.

- **Cpeak** Light weight HTTP framework.
- **Express** HTTP framework.
- **PostgreSQL**: SQL database for this project.
- **Redis**:
  - Cache for customer reads.
  - Redis Streams queue for asynchronous customer creation.
- **Nginx**: reverse proxy and short-lived GET cache.
- **Autocannon**: load-testing scripts for read and write workloads.

The main data model is a `customers` table:

```text
id, name, email, city, country, created_at
```

The schema is created by `npm run db:create`; seed data is inserted by `npm run db:seed`. Neither operation is automatically run by Docker Compose.

## Runtime architecture

```text
Client
  |
  v
Nginx :80
  |-- GET cache for 10 Mins
  |
  v
Cpeak app :3000
  |--------------------> PostgreSQL
  |
  |--------------------> Redis cache
  |
  |--------------------> Redis Stream: dbStream
                                  |
                                  v
                         Redis worker container
                                  |
                                  v
                              PostgreSQL
```

Docker Compose starts:
- `nginx`
- `postgres`
- `redis`
- `app` running `src/cpeakServer.js`
- `worker` running `src/redis/worker/dbWriter.js`

The application and worker both load configuration through `src/config/env.js`, which uses `dotenv`.

## Request flow

### Basic health/root request

```http
GET /
```

Nginx may serve the response from its cache depending on the cache key and 10-min cache policy.

### Direct customer read

```http
GET /customers/v1/:id
```

This is the baseline read path. It does not use Redis application caching, although Nginx can cache the HTTP response for 10 Mins.

Example response shape:

```json
[
  {
    "id": 1,
    "name": "Example User",
    "email": "example@example.com",
    "city": "Pune",
    "country": "IN",
    "created_at": "..."
  }
]
```

### Cached customer read

```http
GET /customers/v2/:id
```

Flow on a cache miss:

```text
Client
  -> Nginx
  -> Cpeak
  -> Redis GET customer:<id> returns null
  -> PostgreSQL SELECT
  -> Response returned to client
  -> Redis SET customer:<id> with 300-second expiration
```

The application uses a cache-aside strategy. The response is returned from PostgreSQL first, and the Redis cache write is performed afterward.

### Direct customer creation

```http
POST /customers/v1
```

Request body:

```json
{
  "name": "Test User",
  "email": "test@example.com",
  "city": "Pune",
  "country": "IN"
}
```

The active Cpeak implementation inserts the customer synchronously, returns the inserted ID, and responds with `201 Created`:

```json
{
  "id": [
    {
      "id": 1
    }
  ],
  "message": "Customer Added"
}
```

### Queued customer creation

```http
POST /customers/v2
```

Flow:

```text
Client
  -> Nginx
  -> Cpeak
  -> Redis XADD dbStream
  -> 202 response with Redis stream message ID

Redis worker
  -> XREADGROUP dbStream
  -> Accumulates messages
  -> Flushes when batch size or timeout is reached
  -> Inserts customers into PostgreSQL
  -> XACKs processed messages
```

This path is asynchronous. A successful HTTP response means the customer was placed in the Redis Stream, not necessarily that the row already exists in PostgreSQL.

The configured defaults in Docker are:

```text
BATCHING_SIZE=100
BATCHING_TIMEOUT=10000 ms
```

The worker uses consumer group `db-writer` and consumer name `worker-1`.

### Customer update

```http
PUT /customers/:id
```

The database is updated first, then the corresponding Redis cache key is invalidated.

There is no `/v1` or `/v2` distinction for update operations.

### Customer deletion

```http
DELETE /customers/v1/:id
```

The active Cpeak implementation deletes the row and invalidates the corresponding Redis cache key before returning `200 OK`.

## Implemented routes

| Method | Route               | Behavior                                        |
| ------ | ------------------- | ----------------------------------------------- |
| GET    | `/`                 | Basic response                                  |
| GET    | `/customers/v1/:id` | Direct PostgreSQL read                          |
| GET    | `/customers/v2/:id` | Redis cache-aside read with PostgreSQL fallback |
| POST   | `/customers/v1`     | Direct PostgreSQL insert                        |
| POST   | `/customers/v2`     | Asynchronous Redis Stream insert                |
| PUT    | `/customers/:id`    | PostgreSQL update and Redis invalidation        |
| DELETE | `/customers/v1/:id` | PostgreSQL delete and Redis invalidation        |

There is also an alternative Express implementation in `src/expressServer.js`. It exposes the same versioned customer read/create routes as the Cpeak implementation, plus the unversioned update and delete routes:

```text
GET    /
GET    /customers/v1/:id
GET    /customers/v2/:id
POST   /customers/v1
POST   /customers/v2
PUT    /customers/:id
DELETE /customers/:id
```

It is not the application selected by the Docker Compose configuration.
