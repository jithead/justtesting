const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
// Load environment variables from .env if present
require('./env')();
const { sendEmail } = require('./email');

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');

// Load users from file
let users = {};
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE));
} catch (e) {
  users = {};
}

// Load questions from file
let boards = {};
try {
  boards = JSON.parse(fs.readFileSync(QUESTIONS_FILE));
} catch (e) {
  boards = {};
}

// In-memory session store
const sessions = {};

function hashPassword(password, salt) {
  const hash = crypto.scryptSync(password, salt, 64);
  return hash.toString('hex');
}

function addUser(username, password, email) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const record = { salt, hash, email: email.trim() };
  users[username] = record;
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function saveBoards() {
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(boards, null, 2));
}

function addQuestion(targetUser, question, author) {
  if (!boards[targetUser]) boards[targetUser] = [];
  boards[targetUser].push({ question, author, votes: 0 });
  saveBoards();

  const user = users[targetUser];
  if (user && user.email) {
    const text = `${author ? author + ' asks: ' : ''}${question}`;
    sendEmail(user.email, 'New Question Submitted', text, (err) => {
      if (err) console.error('Failed to send email:', err.message);
    });
  }
}

function voteQuestion(targetUser, index) {
  if (boards[targetUser] && boards[targetUser][index]) {
    boards[targetUser][index].votes++;
    saveBoards();
  }
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

function layout(title, bodyContent) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body {
        font-family: "Courier New", Courier, monospace;
        max-width: 600px;
        margin: 40px auto;
        padding: 0 10px;
        font-size: 18px;
        line-height: 1.5;
        color: #333;
        background: #fff;
      }
      input, button {
        font-family: inherit;
        font-size: 16px;
        padding: 6px 8px;
      }
      h1 {
        font-weight: normal;
        margin: 0 0 1em 0;
      }
      a {
        color: inherit;
      }
      li + li {
        margin-top: 12px;
      }
    </style>
  </head>
  <body>
    ${bodyContent}
  </body>
</html>`;
}

function signupForm(message = '') {
  return layout('Sign Up', `
    <h1>Sign Up</h1>
    ${message ? `<p style="color:red;">${message}</p>` : ''}
    <form method="POST" action="/signup">
      <p><input name="username" placeholder="Username" required /></p>
      <p><input type="password" name="password" placeholder="Password" required /></p>
      <p><input name="email" type="email" placeholder="Email" required /></p>
      <p><button type="submit">Sign Up</button></p>
    </form>
    <p><a href="/login">Login</a></p>
  `);
}

function loginForm(message = '') {
  return layout('Login', `
    <h1>Login</h1>
    ${message ? `<p style="color:red;">${message}</p>` : ''}
    <form method="POST" action="/login">
      <p><input name="username" placeholder="Username" required /></p>
      <p><input type="password" name="password" placeholder="Password" required /></p>
      <p><button type="submit">Login</button></p>
    </form>
    <p><a href="/signup">Sign Up</a></p>
  `);
}

function questionForm(targetUser, message = '') {
  return layout(`Ask ${targetUser}`, `
    <h1>What would you like ${targetUser} to answer?</h1>
    ${message ? `<p style="color:red;">${message}</p>` : ''}
    <form method="POST" action="/ask/${targetUser}">
      <p><input name="question" maxlength="140" placeholder="Your question" required /></p>
      <p><input name="author" placeholder="Who asked the question? (optional)" /></p>
      <p><button type="submit">Submit</button></p>
    </form>
  `);
}

function boardPage(targetUser, username) {
  const q = (boards[targetUser] || []).slice().sort((a, b) => b.votes - a.votes);
  const items = q.map((item, i) => {
    const text = `${item.question}${item.author ? ' - ' + item.author : ''}`;
    return `<li>${text} <form style="display:inline" method="POST" action="/vote">` +
           `<input type="hidden" name="user" value="${targetUser}" />` +
           `<input type="hidden" name="id" value="${i}" />` +
           `<button type="submit">Upvote (${item.votes})</button>` +
           `</form></li>`;
  }).join('');
  const back = username ? '<p><a href="/">Back</a></p>' : '';
  return layout(`${targetUser}'s Board`, `
    <h1>${targetUser}'s Board</h1>
    <ul>${items}</ul>
    <p><a href="/ask/${targetUser}">Ask a question</a></p>
    ${back}
  `);
}

function homePage(username) {
  return layout('Home', `
    <h1>Welcome${username ? ', ' + username : ''}</h1>
    ${username ? `<p><a href="/board/${username}">Your board</a> | <a href="/ask/${username}">Your question page</a></p><p><a href="/logout">Logout</a></p>` : '<a href="/login">Login</a> | <a href="/signup">Sign Up</a>'}
  `);
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
    const { username, password, email } = await parseBody(req);
    if (!username || !password || !email) {
      send(res, 400, signupForm('Missing username, password or email'));
    } else if (users[username]) {
      send(res, 400, signupForm('Username already exists'));
    } else {
      addUser(username, password, email);
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
  } else if (req.method === 'GET' && url.pathname.startsWith('/ask/')) {
    const targetUser = decodeURIComponent(url.pathname.slice(5));
    send(res, 200, questionForm(targetUser));
  } else if (req.method === 'POST' && url.pathname.startsWith('/ask/')) {
    const targetUser = decodeURIComponent(url.pathname.slice(5));
    const { question, author = '' } = await parseBody(req);
    if (!question) {
      send(res, 400, questionForm(targetUser, 'Question required'));
    } else {
      addQuestion(targetUser, question.slice(0, 140), author.trim());
      send(res, 302, '', { 'Location': `/board/${targetUser}` });
    }
  } else if (req.method === 'GET' && url.pathname.startsWith('/board/')) {
    const targetUser = decodeURIComponent(url.pathname.slice(7));
    send(res, 200, boardPage(targetUser, username));
  } else if (req.method === 'POST' && url.pathname === '/vote') {
    const { user, id } = await parseBody(req);
    voteQuestion(user, parseInt(id, 10));
    send(res, 302, '', { 'Location': `/board/${user}` });
  } else {
    send(res, 404, '<h1>Not Found</h1>');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
