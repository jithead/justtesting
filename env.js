const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  MAILGUN_API_KEY: '6ec241281fb42e718fea838dbb1b0a95',
  MAILGUN_DOMAIN: 'sandboxd82a1d4c864349bb9a164c8342c7e511'
};

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  let data;
  try {
    data = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    data = '';
  }

  data.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });

  Object.keys(DEFAULTS).forEach(key => {
    if (!process.env[key]) {
      process.env[key] = DEFAULTS[key];
    }
  });
}

module.exports = loadEnv;
