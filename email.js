const https = require('https');
const querystring = require('querystring');

function sendEmail(to, subject, text, callback) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!apiKey || !domain) {
    console.log('Mailgun credentials not set; skipping email');
    if (callback) callback(new Error('Mailgun credentials not set'));
    return;
  }

  const postData = querystring.stringify({
    from: `noreply@${domain}`,
    to,
    subject,
    text
  });

  const options = {
    hostname: 'api.mailgun.net',
    path: `/v3/${domain}/messages`,
    method: 'POST',
    auth: `api:${apiKey}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = https.request(options, (res) => {
    res.setEncoding('utf8');
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (callback) callback(null, data);
      } else {
        if (callback) callback(new Error(`Mailgun error: ${res.statusCode} ${data}`));
      }
    });
  });

  req.on('error', (err) => {
    if (callback) callback(err);
  });

  req.write(postData);
  req.end();
}

module.exports = { sendEmail };
