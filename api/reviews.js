
// VEX.STUDY community reviews API
// Vercel serverless function
// Storage: Upstash Redis

const crypto = require('crypto');

const URL_ =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL;

const TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN;

const H = 'vex:reviews';
const HIDE_AT = 3;
const DUP_DAYS = 30;
const MAX_PER_HOUR = 5;

async function r(...cmd) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + TOKEN
    },
    body: JSON.stringify(cmd)
  });

  const j = await res.json();

  if (j.error) throw new Error(j.error);

  return j.result;
}

const sha = (s) =>
  crypto.createHash('sha256').update(s).digest('hex');

const BAD =
  /\b(fuck|shit|bitch|cunt|nigg|fag|retard|slut|whore|porn|nude|kill yourself|kys)\w*/i;

function unsafe(t) {
  return (
    /https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|ru|xyz|app)\b/i.test(t) ||
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(t) ||
    /(\+?\d[\d\s().-]{8,}\d)/.test(t) ||
    /@\w{3,}/.test(t) ||
    BAD.test(t)
  );
}

function adminOk(req) {
  const a = Buffer.from(
    (req.headers.authorization || '').replace(/^Bearer /, '')
  );

  const b = Buffer.from(
    process.env.REVIEWS_ADMIN_TOKEN || ''
  );

  return (
    b.length > 15 &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

const pub = (v) => ({
  id: v.id,
  rating: v.rating,
  text: v.text,
  name: v.name,
  ts: v.ts
});

module.exports = async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (
    !URL_ ||
    !TOKEN ||
    !process.env.REVIEWS_SALT
  ) {
    return res.status(503).json({
      error: 'Reviews backend is not configured yet.'
    });
  }

  try {
    if (req.method === 'GET') {
      const raw = await r('HGETALL', H);
      const items = [];

      for (
        let i = 0;
        raw && i < raw.length;
        i += 2
      ) {
        items.push(JSON.parse(raw[i + 1]));
      }

      if (req.query.admin) {
        if (!adminOk(req)) {
          return res.status(401).json({
            error: 'Unauthorized'
          });
        }

        res.setHeader('Cache-Control', 'no-store');

        return res.json({
          reviews: items
        });
      }

      const live = items
        .filter((v) => v.status === 'published')
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 200);

      const count = live.length;

      const average = count
        ? Math.round(
            (live.reduce((s, v) => s + v.rating, 0) /
              count) * 10
          ) / 10
        : 0;

      res.setHeader(
        'Cache-Control',
        'public, s-maxage=20, stale-while-revalidate=60'
      );

      return res.json({
        count,
        average,
        reviews: live.map(pub)
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method not allowed'
      });
    }

    const b =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : req.body || {};

    res.setHeader('Cache-Control', 'no-store');

    if (b.action === 'moderate') {
      if (!adminOk(req)) {
        return res.status(401).json({
          error: 'Unauthorized'
        });
      }

      const cur = await r('HGET', H, b.id);

      if (!cur) {
        return res.status(404).json({
          error: 'Not found'
        });
      }

      if (b.status === 'delete') {
        await r('HDEL', H, b.id);
      } else if (
        ['published', 'hidden', 'pending'].includes(b.status)
      ) {
        const v = JSON.parse(cur);
        v.status = b.status;

        await r(
          'HSET',
          H,
          b.id,
          JSON.stringify(v)
        );
      } else {
        return res.status(400).json({
          error: 'Bad status'
        });
      }

      return res.json({ ok: true });
    }

    const ip = (
      req.headers['x-forwarded-for'] || ''
    ).split(',')[0].trim() || 'x';

    const fp = sha(
      process.env.REVIEWS_SALT +
      '|' +
      ip +
      '|' +
      (req.headers['user-agent'] || '')
    );

    const used = await r(
      'INCR',
      'vex:rl:' + fp
    );

    if (used === 1) {
      await r(
        'EXPIRE',
        'vex:rl:' + fp,
        3600
      );
    }

    if (used > MAX_PER_HOUR) {
      return res.status(429).json({
        error: 'Too many requests. Try again later.'
      });
    }

    if (b.action === 'report') {
      const cur = await r(
        'HGET',
        H,
        String(b.id || '')
      );

      if (!cur) {
        return res.status(404).json({
          error: 'Review not found'
        });
      }

      await r('SADD', 'vex:rep:' + b.id, fp);

      if (
        (await r('SCARD', 'vex:rep:' + b.id)) >= HIDE_AT
      ) {
        const v = JSON.parse(cur);
        v.status = 'hidden';

        await r(
          'HSET',
          H,
          b.id,
          JSON.stringify(v)
        );
      }

      return res.json({ ok: true });
    }

    if (b.action === 'delete') {
      const cur = await r(
        'HGET',
        H,
        String(b.id || '')
      );

      if (
        !cur ||
        !b.token ||
        JSON.parse(cur).tk !== sha(String(b.token))
      ) {
        return res.status(403).json({
          error: 'Not allowed'
        });
      }

      await r('HDEL', H, b.id);

      return res.json({ ok: true });
    }

    if (b.action !== 'submit') {
      return res.status(400).json({
        error: 'Bad request'
      });
    }

    const rating = Number(b.rating);

    const text = String(b.text || '')
      .trim()
      .replace(/\s+/g, ' ');

    const name = String(b.name || '')
      .trim()
      .slice(0, 24);

    if (b.website) {
      return res.json({
        ok: true,
        status: 'pending'
      });
    }

    if (!(Number(b.t) >= 4000)) {
      return res.status(400).json({
        error: 'Please take a moment to write your review.'
      });
    }

    if (b.consent !== true) {
      return res.status(400).json({
        error: 'Please accept the consent box.'
      });
    }

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return res.status(400).json({
        error: 'Choose a star rating.'
      });
    }

    if (text.length < 20 || text.length > 1000) {
      return res.status(400).json({
        error: 'Reviews must be 20 to 1000 characters.'
      });
    }

    if (unsafe(text) || unsafe(name)) {
      return res.status(400).json({
        error: 'Remove links, contact details, personal info or unsafe language and try again.'
      });
    }

    const first = await r(
      'SET',
      'vex:fp:' + fp,
      'x',
      'NX',
      'EX',
      DUP_DAYS * 86400
    );

    if (!first) {
      return res.status(409).json({
        error: 'You have already reviewed VEX.STUDY recently.'
      });
    }

    const id = crypto.randomBytes(8).toString('hex');

    const token = crypto.randomBytes(16).toString('hex');

    const status =
      process.env.REVIEWS_REQUIRE_APPROVAL === '1'
        ? 'pending'
        : 'published';

    await r(
      'HSET',
      H,
      id,
      JSON.stringify({
        id,
        rating,
        text,
        name: name || 'Anonymous student',
        ts: Date.now(),
        status,
        tk: sha(token)
      })
    );

    return res.json({
      ok: true,
      id,
      token,
      status
    });

  } catch (e) {
    return res.status(500).json({
      error: 'Something went wrong. Please try again.'
    });
  }
};
    
