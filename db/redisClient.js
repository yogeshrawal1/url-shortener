const { createClient } = require('redis');
require('dotenv').config();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        console.error(`Redis: giving up after ${retries} failed reconnect attempts.`);
        return new Error('Too many retries.');
      }
      // Wait a bit longer each time (200ms, 400ms, 600ms...), capped at 3s
      return Math.min(retries * 200, 3000);
    },
  },
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis'));

(async () => {
  await redisClient.connect();
})();

module.exports = redisClient;
