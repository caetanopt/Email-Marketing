const { SESClient, GetSendQuotaCommand } = require('@aws-sdk/client-ses');
const { requireAuth, cors } = require('../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  const user = requireAuth(req, res);
  if (!user) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const region = process.env.AWS_REGION || process.env.AWS_SES_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey || !region) {
    return res.status(200).json({ configured: false });
  }

  try {
    const client = new SESClient({ region, credentials: { accessKeyId, secretAccessKey } });
    const { Max24HourSend, SentLast24Hours, MaxSendRate } = await client.send(new GetSendQuotaCommand({}));
    return res.status(200).json({
      configured: true,
      max24h: Math.floor(Max24HourSend),
      sent24h: Math.floor(SentLast24Hours),
      remaining: Math.floor(Max24HourSend - SentLast24Hours),
      maxRate: MaxSendRate,
    });
  } catch (err) {
    return res.status(200).json({ configured: true, error: err.message });
  }
};
