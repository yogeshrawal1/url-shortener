# URL Shortener

A simple URL shortener built with **Node.js + Express**, **PostgreSQL** (persistent storage), **Redis** (cache for fast redirects), and a plain **HTML/CSS/JS** frontend (no framework, no build step).

## How it works

- `POST /api/shorten` — inserts `{ short_code, long_url }` into Postgres, then warms a Redis key `short:<code>` with a TTL.
- `GET /:code` — checks Redis first (cache hit = instant redirect). On a cache miss, it falls back to Postgres, redirects, and repopulates the cache. Click counts are updated in Postgres asynchronously so they never slow down the redirect.
- `GET /api/stats/:code` — returns click count and metadata straight from Postgres (source of truth).

## Prerequisites

- Node.js 18+
- PostgreSQL running locally (or remote)
- Redis running locally (or remote)

If you don't have Postgres/Redis installed locally, the fastest way is Docker:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=url_shortener -p 5432:5432 postgres:16
docker run -d --name redis -p 6379:6379 redis:7
```

## Setup

```bash
cd url-shortener
npm install
cp .env.example .env
# edit .env if your DB/Redis credentials differ from the defaults

npm run migrate   # creates the "urls" table
npm start         # starts the server on http://localhost:3000
```

Then open **http://localhost:3000** in your browser.

## Project structure

```
url-shortener/
├── server.js           # Express app: shorten, redirect, stats routes
├── db/
│   ├── pool.js          # PostgreSQL connection pool
│   ├── redisClient.js   # Redis client
│   └── migrate.js       # Creates the urls table
├── public/
│   ├── index.html        # Frontend UI
│   └── 404.html          # Shown when a short code doesn't exist
├── package.json
└── .env.example
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

## Notes / things you may want to extend

- **Rate limiting**: add `express-rate-limit` on `/api/shorten` to prevent abuse.
- **Expiring links**: add an `expires_at` column and check it in the redirect route.
- **Auth**: currently anyone can create links; add API keys or user accounts if needed.
- **Horizontal scaling**: since click counts are updated in Postgres async and caching is in Redis, this design already scales well across multiple app instances behind a load balancer.
