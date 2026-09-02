# URL Shortener

A simple URL shortener built with **Node.js + Express**, **PostgreSQL** (persistent storage, hosted on [Neon](https://neon.tech)), **Redis** (cache for fast redirects, hosted on [Upstash](https://upstash.com)), and a plain **HTML/CSS/JS** frontend (no framework, no build step).

## How it works

- `POST /api/shorten` — inserts `{ short_code, long_url }` into Postgres, then warms a Redis key `short:<code>` with a TTL.
- `GET /:code` — checks Redis first (cache hit = instant redirect). On a cache miss, it falls back to Postgres, redirects, and repopulates the cache. Click counts are updated in Postgres asynchronously so they never slow down the redirect.
- `GET /api/stats/:code` — returns click count and metadata straight from Postgres (source of truth).

## Prerequisites

- Node.js 18+
- A free [Neon](https://neon.tech) account (hosted PostgreSQL)
- A free [Upstash](https://upstash.com) account (hosted Redis)

No local database installs and no Docker required — both databases run in the cloud.

### 1. Set up Neon (PostgreSQL)

1. Sign up at [neon.tech](https://neon.tech) and create a new project.
2. On the project dashboard, copy the **connection string** shown under "Connection Details." It looks like:
   ```
   postgresql://user:password@ep-cool-forest-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
3. You'll paste this into `.env` as `DATABASE_URL` in the setup steps below.

### 2. Set up Upstash (Redis)

1. Sign up at [upstash.com](https://upstash.com) and create a new Redis database.
2. On the database dashboard, copy the **TLS connection string** — it must start with `rediss://` (double "s" — this means encrypted). Using `redis://` (single "s") against Upstash will fail with connection errors. It looks like:
   ```
   rediss://default:AbCdEf123456@some-name-12345.upstash.io:6379
   ```
3. You'll paste this into `.env` as `REDIS_URL` in the setup steps below.

## Setup

```bash
cd url-shortener
npm install
cp .env.example .env
```

Now open `.env` and fill in the two values from above:
```
DATABASE_URL=postgresql://user:password@ep-cool-forest-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
REDIS_URL=rediss://default:AbCdEf123456@some-name-12345.upstash.io:6379
```

Then:
```bash
npm run migrate   # creates the "urls" table on your Neon database
npm start         # starts the server on http://localhost:3000
```

Then open **http://localhost:3000** in your browser.

## Project structure

```
url-shortener/
├── server.js           # Express app: shorten, redirect, stats routes
├── db/
│   ├── pool.js          # PostgreSQL connection pool (Neon via DATABASE_URL)
│   ├── redisClient.js   # Redis client (Upstash via REDIS_URL)
│   └── migrate.js       # Creates the urls table
├── public/
│   ├── index.html        # Frontend UI
│   └── 404.html          # Shown when a short code doesn't exist
├── package.json
├── .env.example
└── .gitignore
```

## Database schema

```sql
CREATE TABLE urls (
  id SERIAL PRIMARY KEY,
  short_code VARCHAR(20) UNIQUE NOT NULL,
  long_url TEXT NOT NULL,
  click_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ
);
```

## API reference

### Create a short URL
```
POST /api/shorten
Content-Type: application/json

{ "url": "https://example.com/a/very/long/path", "customCode": "my-link" }   // customCode is optional
```
Response `201`:
```json
{
  "shortCode": "my-link",
  "shortUrl": "http://localhost:3000/my-link",
  "longUrl": "https://example.com/a/very/long/path",
  "createdAt": "2026-08-27T10:00:00.000Z"
}
```

### Redirect
```
GET /:code   →  302 redirect to the original URL
```

### Stats
```
GET /api/stats/:code
```
Response `200`:
```json
{
  "shortCode": "my-link",
  "shortUrl": "http://localhost:3000/my-link",
  "longUrl": "https://example.com/a/very/long/path",
  "clicks": 42,
  "createdAt": "2026-08-27T10:00:00.000Z",
  "lastAccessedAt": "2026-08-27T12:34:56.000Z"
}
```

## Deploying so it's accessible on the internet

Neon and Upstash already host your databases in the cloud — the only piece still running on your own machine is the Node app itself. To make the whole thing publicly accessible, deploy `server.js` to a host that runs persistent Node servers, such as [Render](https://render.com) or [Railway](https://railway.app):

1. Push this project to a GitHub repo (`.env` is excluded via `.gitignore` — never commit real secrets).
2. Create a new Web Service on Render, connect your repo.
3. Build command: `npm install`. Start command: `npm start`.
4. In Render's dashboard, add the same environment variables from your `.env` (`DATABASE_URL`, `REDIS_URL`), plus `BASE_URL` set to the public URL Render gives you once deployed.
5. Redeploy after setting `BASE_URL` so shortened links point at your live domain instead of `localhost`.

## Notes / things you may want to extend

- **Rate limiting**: add `express-rate-limit` on `/api/shorten` to prevent abuse.
- **Expiring links**: add an `expires_at` column and check it in the redirect route.
- **Auth**: currently anyone can create links; add API keys or user accounts if needed.
- **Horizontal scaling**: since click counts are updated in Postgres async and caching is in Redis, this design already scales well across multiple app instances behind a load balancer.
- **Neon autosuspend**: Neon's free tier pauses your database after inactivity; the first query after idling may take a second longer while it wakes up. This is automatic and needs no code changes.
