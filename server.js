require('dotenv').config();
const express = require('express');
const path = require('path');
const { nanoid } = require('nanoid');
const validUrl = require('valid-url');

const pool = require('./db/pool');
const redisClient = require('./db/redisClient');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS) || 86400;
const SHORT_CODE_LENGTH = Number(process.env.SHORT_CODE_LENGTH) || 7;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Helpers ----

async function generateUniqueCode() {
  // Try a handful of times in case of collision (astronomically unlikely, but be safe)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = nanoid(SHORT_CODE_LENGTH);
    const existing = await pool.query('SELECT 1 FROM urls WHERE short_code = $1', [code]);
    if (existing.rowCount === 0) return code;
  }
  throw new Error('Could not generate a unique short code, please try again.');
}

// ---- Routes ----

// Create a short URL
app.post('/api/shorten', async (req, res) => {
  try {
    const { url, customCode } = req.body;

    if (!url || !validUrl.isWebUri(url)) {
      return res.status(400).json({ error: 'Please provide a valid URL (including http:// or https://).' });
    }

    let shortCode;

    if (customCode) {
      const isValidCustom = /^[a-zA-Z0-9_-]{3,20}$/.test(customCode);
      if (!isValidCustom) {
        return res.status(400).json({
          error: 'Custom code must be 3-20 characters, letters, numbers, hyphens or underscores only.',
        });
      }
      const existing = await pool.query('SELECT 1 FROM urls WHERE short_code = $1', [customCode]);
      if (existing.rowCount > 0) {
        return res.status(409).json({ error: 'That custom code is already taken.' });
      }
      shortCode = customCode;
    } else {
      shortCode = await generateUniqueCode();
    }

    const result = await pool.query(
      'INSERT INTO urls (short_code, long_url) VALUES ($1, $2) RETURNING short_code, long_url, created_at',
      [shortCode, url]
    );

    // Warm the cache
    await redisClient.set(`short:${shortCode}`, url, { EX: CACHE_TTL_SECONDS });

    const row = result.rows[0];
    return res.status(201).json({
      shortCode: row.short_code,
      shortUrl: `${BASE_URL}/${row.short_code}`,
      longUrl: row.long_url,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('Error creating short URL:', err);
    return res.status(500).json({ error: 'Something went wrong while shortening the URL.' });
  }
});

// Get stats for a short code
app.get('/api/stats/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      'SELECT short_code, long_url, click_count, created_at, last_accessed_at FROM urls WHERE short_code = $1',
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }

    const row = result.rows[0];
    return res.json({
      shortCode: row.short_code,
      shortUrl: `${BASE_URL}/${row.short_code}`,
      longUrl: row.long_url,
      clicks: Number(row.click_count),
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    return res.status(500).json({ error: 'Something went wrong while fetching stats.' });
  }
});

// Redirect short URL -> long URL (this is the hot path, so it checks Redis first)
app.get('/:code', async (req, res) => {
  const { code } = req.params;

  // Skip favicon and similar noise requests
  if (code === 'favicon.ico') return res.status(204).end();

  try {
    let longUrl = await redisClient.get(`short:${code}`);
    let cacheHit = Boolean(longUrl);

    if (!longUrl) {
      const result = await pool.query('SELECT long_url FROM urls WHERE short_code = $1', [code]);
      if (result.rowCount === 0) {
        return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
      }
      longUrl = result.rows[0].long_url;
      // Repopulate cache for next time
      await redisClient.set(`short:${code}`, longUrl, { EX: CACHE_TTL_SECONDS });
    }

    // Fire-and-forget click tracking so the redirect isn't delayed
    pool
      .query(
        'UPDATE urls SET click_count = click_count + 1, last_accessed_at = NOW() WHERE short_code = $1',
        [code]
      )
      .catch((err) => console.error('Error updating click count:', err));

    return res.redirect(302, longUrl);
  } catch (err) {
    console.error('Error resolving short URL:', err);
    return res.status(500).send('Something went wrong.');
  }
});

app.listen(PORT, () => {
  console.log(`URL shortener running at ${BASE_URL}`);
});
