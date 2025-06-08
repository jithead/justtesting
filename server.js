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

function addQuestion(targetUser, question, author, email = '') {
  if (!boards[targetUser]) boards[targetUser] = [];

  const followers = [];
  if (email) {
    followers.push(email);
  }
  boards[targetUser].push({ question, author, email, votes: followers.length, followers });
  saveBoards();

  const user = users[targetUser];
  if (user && user.email) {
    const text = `${author ? author + ' asks: ' : ''}${question}`;
    sendEmail(user.email, 'New Question Submitted', text, (err) => {
      if (err) console.error('Failed to send email:', err.message);
    });
  }
}

function followQuestion(targetUser, index, email) {
  if (boards[targetUser] && boards[targetUser][index]) {
    const q = boards[targetUser][index];
    if (!q.followers) q.followers = [];
    if (email && !q.followers.includes(email)) {
      q.followers.push(email);
      q.votes = q.followers.length;
      saveBoards();
    }
  }
}

function answerQuestion(targetUser, index, link) {
  if (boards[targetUser] && boards[targetUser][index]) {
    const q = boards[targetUser][index];
    q.answer = link;
    q.answeredAt = new Date().toISOString();
    saveBoards();

    const text = `Hello!\n\n${targetUser} has answered the question that you're following:\n\n${q.question}.\n\nYou can see their answer here: ${link}`;
    (q.followers || []).forEach(email => {
      sendEmail(email, 'Question Answered', text, (err) => {
        if (err) console.error('Failed to send email:', err.message);
      });
    });
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

function questionForm(targetUser, message = '', username) {
  const popup = username ? '' : `
    <div id="emailPopup" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);">
      <div style="background:#fff;padding:20px;max-width:300px;margin:100px auto;position:relative;">
        <button id="closeEmailPopup" style="position:absolute;top:4px;right:4px;">x</button>
        <div id="guestOptions">
          <p><a href="/login">Log in</a> | <a href="/signup">Create an account</a></p>
          <p><button id="continueGuestBtn">Continue as Guest</button></p>
        </div>
        <form id="guestEmailForm" style="display:none;">
          <p>We need your email address to update you when this is answered, but we won't create an account.</p>
          <p><input type="email" id="guestEmailInput" placeholder="Email" required /></p>
          <p><button type="submit">Submit Question</button></p>
        </form>
      </div>
    </div>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        var askForm = document.getElementById('askForm');
        var popup = document.getElementById('emailPopup');
        var guestOptions = document.getElementById('guestOptions');
        var guestEmailForm = document.getElementById('guestEmailForm');
        document.getElementById('continueGuestBtn').addEventListener('click', function(e) {
          e.preventDefault();
          guestOptions.style.display = 'none';
          guestEmailForm.style.display = 'block';
        });
        document.getElementById('closeEmailPopup').addEventListener('click', function(e) {
          e.preventDefault();
          popup.style.display = 'none';
        });
        askForm.addEventListener('submit', function(e) {
          e.preventDefault();
          popup.style.display = 'block';
        });
        guestEmailForm.addEventListener('submit', function(e) {
          e.preventDefault();
          var email = document.getElementById('guestEmailInput').value.trim();
          if (email) document.getElementById('guestEmail').value = email;
          popup.style.display = 'none';
          askForm.submit();
        });
      });
    </script>
  `;

  const hiddenEmail = username ? '' : '<input type="hidden" id="guestEmail" name="guestEmail" />';

  return layout(`Ask ${targetUser}`, `
    ${popup}
    <h1>What would you like ${targetUser} to answer?</h1>
    ${message ? `<p style="color:red;">${message}</p>` : ''}
    <form id="askForm" method="POST" action="/ask/${targetUser}">
      <p><input name="question" maxlength="140" placeholder="Your question" required /></p>
      <p><input name="author" placeholder="Who asked the question? (optional)" /></p>
      ${hiddenEmail}
      <p><button type="submit">Submit</button></p>
    </form>
  `);
}

function boardPage(targetUser, username) {
  const popup = username ? '' : `
    <div id="emailPopup" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);">
      <div style="background:#fff;padding:20px;max-width:300px;margin:100px auto;position:relative;">
        <button id="closeEmailPopup" style="position:absolute;top:4px;right:4px;">x</button>
        <div id="guestOptions">
          <p><a href="/login">Log in</a> | <a href="/signup">Create an account</a></p>
          <p><button id="continueGuestBtn">Continue as Guest</button></p>
        </div>
        <form id="guestEmailForm" style="display:none;">
          <p>We need your email address to update you when this is answered, but we won't create an account.</p>
          <p><input type="email" id="guestEmailInput" placeholder="Email" required /></p>
          <p><button type="submit">Follow Question</button></p>
        </form>
      </div>
    </div>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        var popup = document.getElementById('emailPopup');
        var guestOptions = document.getElementById('guestOptions');
        var guestEmailForm = document.getElementById('guestEmailForm');
        var currentForm = null;
        document.getElementById('continueGuestBtn').addEventListener('click', function(e) {
          e.preventDefault();
          guestOptions.style.display = 'none';
          guestEmailForm.style.display = 'block';
        });
        document.getElementById('closeEmailPopup').addEventListener('click', function(e) {
          e.preventDefault();
          popup.style.display = 'none';
        });
        document.querySelectorAll('.followForm').forEach(function(form) {
          form.addEventListener('submit', function(e) {
            e.preventDefault();
            currentForm = form;
            popup.style.display = 'block';
          });
        });
        guestEmailForm.addEventListener('submit', function(e) {
          e.preventDefault();
          var email = document.getElementById('guestEmailInput').value.trim();
          if (email && currentForm) currentForm.querySelector('.guestEmail').value = email;
          popup.style.display = 'none';
          if (currentForm) currentForm.submit();
        });
      });
    </script>
  `;

  const answerPopup = username === targetUser ? `
    <div id="answerPopup" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);">
      <div style="background:#fff;padding:20px;max-width:400px;margin:100px auto;position:relative;">
        <button id="closeAnswerPopup" style="position:absolute;top:4px;right:4px;">x</button>
        <p><em id="answerQuestionText"></em></p>
        <p>Enter a link to a blog / video / post with your answer below, and we'll update everyone that's asked you to answer it.</p>
        <form id="answerForm" method="POST" action="/answer">
          <input type="hidden" name="user" value="${targetUser}" />
          <input type="hidden" name="id" id="answerQuestionId" />
          <p><input name="link" id="answerLinkInput" required /></p>
          <p><button type="submit">Share your answer</button></p>
        </form>
      </div>
    </div>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('.answerBtn').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            document.getElementById('answerQuestionText').textContent = btn.dataset.question;
            document.getElementById('answerQuestionId').value = btn.dataset.id;
            document.getElementById('answerPopup').style.display = 'block';
          });
        });
        document.getElementById('closeAnswerPopup').addEventListener('click', function(e) {
          e.preventDefault();
          document.getElementById('answerPopup').style.display = 'none';
        });
      });
    </script>
  ` : '';

  const list = boards[targetUser] || [];
  const unanswered = list
    .map((item, idx) => ({ item, idx }))
    .filter(q => !q.item.answer)
    .sort((a, b) => b.item.votes - a.item.votes);
  const answered = list
    .map((item, idx) => ({ item, idx }))
    .filter(q => q.item.answer)
    .sort((a, b) => new Date(a.item.answeredAt || 0) - new Date(b.item.answeredAt || 0));

  function renderItem(q) {
    const item = q.item;
    const i = q.idx;
    const text = `${item.question}${item.author ? ' - ' + item.author : ''}`;
    const count = item.followers ? item.followers.length : item.votes;
    const hiddenEmail = username ? '' : '<input type="hidden" name="guestEmail" class="guestEmail" />';
    if (item.answer) {
      return `<li>${text} <a href="${item.answer}" style="color:green;">Answered!</a></li>`;
    }
    if (username === targetUser) {
      return `<li>${text} <button class="answerBtn" data-id="${i}" data-question="${text}">Answer (${count})</button></li>`;
    }
    return `<li>${text} <form class="followForm" style="display:inline" method="POST" action="/follow">` +
           `<input type="hidden" name="user" value="${targetUser}" />` +
           `<input type="hidden" name="id" value="${i}" />` +
           `${hiddenEmail}` +
           `<button type="submit">Follow (${count})</button>` +
           `</form></li>`;
  }

  const unansweredItems = unanswered.map(renderItem).join('');
  const answeredItems = answered.map(renderItem).join('');
  const back = username ? '<p><a href="/">Back</a></p>' : '';
  return layout(`${targetUser}'s Board`, `
    ${popup}
    ${answerPopup}
    <h1>${targetUser}'s Board</h1>
    <h2>Unanswered Questions</h2>
    <ul>${unansweredItems}</ul>
    <h2>Answered Questions</h2>
    <ul>${answeredItems}</ul>
    <p><a href="/ask/${targetUser}">Ask a question</a></p>
    ${back}
  `);
}

function homePage(username) {
  return layout('Home', `
    <h1>Welcome to Pulley${username ? ', ' + username : ''}</h1>
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
    send(res, 200, questionForm(targetUser, '', username));
  } else if (req.method === 'POST' && url.pathname.startsWith('/ask/')) {
    const targetUser = decodeURIComponent(url.pathname.slice(5));
    const { question, author = '', guestEmail = '' } = await parseBody(req);
    if (!question) {
      send(res, 400, questionForm(targetUser, 'Question required', username));
    } else {
      const userEmail = username && users[username] ? users[username].email : '';
      const email = userEmail || guestEmail.trim();
      addQuestion(targetUser, question.slice(0, 140), author.trim(), email);
      send(res, 302, '', { 'Location': `/board/${targetUser}` });
    }
  } else if (req.method === 'GET' && url.pathname.startsWith('/board/')) {
    const targetUser = decodeURIComponent(url.pathname.slice(7));
    send(res, 200, boardPage(targetUser, username));
  } else if (req.method === 'POST' && url.pathname === '/follow') {
    const { user, id, guestEmail = '' } = await parseBody(req);
    const userEmail = username && users[username] ? users[username].email : '';
    const email = userEmail || guestEmail.trim();
    followQuestion(user, parseInt(id, 10), email);
    send(res, 302, '', { 'Location': `/board/${user}` });
  } else if (req.method === 'POST' && url.pathname === '/answer') {
    const { user, id, link } = await parseBody(req);
    if (username !== user) {
      send(res, 403, '<h1>Forbidden</h1>');
    } else if (!link) {
      send(res, 400, '<h1>Link required</h1>');
    } else {
      answerQuestion(user, parseInt(id, 10), link.trim());
      send(res, 302, '', { 'Location': `/board/${user}` });
    }
  } else {
    send(res, 404, '<h1>Not Found</h1>');
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
