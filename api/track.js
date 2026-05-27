/**
 * /api/track
 *
 * GET ?type=open&cid=<campaignId>&uid=<contactId>&t=<token>
 *   → Returns a 1×1 transparent GIF and records the open in email_events.
 *
 * GET ?type=click&cid=<campaignId>&uid=<contactId>&t=<token>&url=<destination>
 *   → Redirects to destination URL and records the click in email_events.
 */
const { query } = require('../lib/db');
const crypto = require('crypto');

// 1×1 transparent GIF (base64)
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function trackToken(campaignId, contactId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET)
    .update(`track:${campaignId}:${contactId}`)
    .digest('hex').slice(0, 16);
}

module.exports = async (req, res) => {
  const { type, cid, uid, t, url } = req.query;

  // ── Click tracking: redirect immediately, then record ──────────
  if (type === 'click') {
    const dest = url && url.startsWith('http') ? url : '/';
    res.setHeader('Location', dest);
    res.setHeader('Cache-Control', 'no-store');
    res.status(302).end();

    // Record asynchronously — don't block redirect
    try {
      if (!cid || !uid || !t) return;
      const expected = trackToken(cid, uid);
      if (t !== expected) return;

      const campaignId = parseInt(cid, 10);
      const contactId  = parseInt(uid, 10);
      if (isNaN(campaignId) || isNaN(contactId)) return;

      await query(
        `INSERT INTO email_events (campaign_id, contact_id, type, url, created_at)
         VALUES ($1, $2, 'click', $3, NOW())`,
        [campaignId, contactId, url || null]
      );
    } catch (e) {
      console.error('track click error:', e.message);
    }
    return;
  }

  // ── Open tracking: return pixel immediately, then record ───────
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).end(PIXEL);

  try {
    if (!cid || !uid || !t) return;
    const expected = trackToken(cid, uid);
    if (t !== expected) return;

    const campaignId = parseInt(cid, 10);
    const contactId  = parseInt(uid, 10);
    if (isNaN(campaignId) || isNaN(contactId)) return;

    await query(
      `INSERT INTO email_events (campaign_id, contact_id, type, created_at)
       VALUES ($1, $2, 'open', NOW())`,
      [campaignId, contactId]
    );
  } catch (e) {
    console.error('track open error:', e.message);
  }
};
