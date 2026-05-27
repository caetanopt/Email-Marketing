/**
 * GET /api/track?type=open&cid=<campaignId>&uid=<contactId>&t=<token>
 *
 * Tracking pixel for email open events.
 * Returns a 1×1 transparent GIF and records the open in email_events.
 */
const { query } = require('../lib/db');
const crypto = require('crypto');

// 1×1 transparent GIF
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
  // Always return the pixel immediately — don't block on DB
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).end(PIXEL);

  try {
    const { type, cid, uid, t } = req.query;
    if (!cid || !uid || !t) return;

    // Validate HMAC token to prevent fake events
    const expected = trackToken(cid, uid);
    if (t !== expected) return;

    if (type === 'open') {
      // Insert open event (ignore duplicates — same contact can open multiple times)
      await query(
        `INSERT INTO email_events (campaign_id, contact_id, type, created_at)
         VALUES ($1, $2, 'open', NOW())`,
        [parseInt(cid, 10), parseInt(uid, 10)]
      );
    }
  } catch (e) {
    // Swallow errors — pixel already returned, don't affect user experience
    console.error('track pixel error:', e.message);
  }
};
