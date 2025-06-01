const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');

// Load users from file
let users = {};
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE));
} catch (e) {
  users = {};
}

// In-memory session store
const sessions = {};

function hashPassword(password, salt) {
  const hash = crypto.scryptSync(password, salt, 64);
  return hash.toString('hex');
}

function addUser(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  users[username] = { salt, hash };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function authenticate(username, password) {
  const record = users[username];
  if (!record) return false;
  const hash = hashPassword(password, record.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(record.hash, 'hex'));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const result = {};
      for (const [key, value] of params.entries()) {
        result[key] = value;
      }
      resolve(result);
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(/;\s*/).forEach(pair => {
    const [name, ...rest] = pair.split('=');
    if (!name) return;
    cookies[name] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({'Content-Type': 'text/html'}, headers));
  res.end(body);
}

function signupForm(message = '') {
  return `<!DOCTYPE html>
<html>
  <body>
    <h1>Sign Up</h1>
    ${message ? `<p style="color:red;">${message}</p>` : ''}
    <form method="POST" action="/signup">
      <input name="username" placeholder="Username" required />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Sign Up</button>
    </form>
    <a href="/login">Login</a>
  </body>
</html>`;
}

function loginForm(message = '') {
  return `<!DOCTYPE html>
<html>
  <body>
    <h1>Login</h1>
    ${message ? `<p style="color:red;">${message}</p>` : ''}
    <form method="POST" action="/login">
      <input name="username" placeholder="Username" required />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Login</button>
    </form>
    <a href="/signup">Sign Up</a>
  </body>
</html>`;
}

function homePage(username) {
  return `<!DOCTYPE html>
<html>
  <body>
    <h1>Welcome${username ? ', ' + username : ''}</h1>
    ${username ? '<a href="/logout">Logout</a>' : '<a href="/login">Login</a> | <a href="/signup">Sign Up</a>'}
  </body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cookies = parseCookies(req);
  const username = sessions[cookies.sessionId];

  if (req.method === 'GET' && url.pathname === '/') {
    send(res, 200, homePage(username));
  } else if (req.method === 'GET' && url.pathname === '/signup') {
    send(res, 200, signupForm());
  } else if (req.method === 'POST' && url.pathname === '/signup') {
    const { username, password } = await parseBody(req);
    if (!username || !password) {
      send(res, 400, signupForm('Missing username or password'));
    } else if (users[username]) {
      send(res, 400, signupForm('Username already exists'));
    } else {
      addUser(username, password);
      send(res, 302, '', { 'Location': '/login' });
    }
  } else if (req.method === 'GET' && url.pathname === '/login') {
    send(res, 200, loginForm());
  } else if (req.method === 'POST' && url.pathname === '/login') {
    const { username, password } = await parseBody(req);
    if (authenticate(username, password)) {
      const sessionId = crypto.randomBytes(16).toString('hex');
      sessions[sessionId] = username;
      send(res, 302, '', { 'Set-Cookie': `sessionId=${sessionId}; HttpOnly`, 'Location': '/' });
    } else {
      send(res, 401, loginForm('Invalid username or password'));
    }
  } else if (req.method === 'GET' && url.pathname === '/logout') {
    if (cookies.sessionId) {
      delete sessions[cookies.sessionId];
    }
    send(res, 302, '', { 'Set-Cookie': 'sessionId=; Max-Age=0', 'Location': '/' });
  } else {
    send(res, 404, '<h1>Not Found</h1>');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
