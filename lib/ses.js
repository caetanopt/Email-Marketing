const { SESClient } = require('@aws-sdk/client-ses');

let client;

function getSESClient() {
  if (!client) {
    client = new SESClient({
      region: process.env.AWS_REGION || 'eu-west-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

module.exports = { getSESClient };
