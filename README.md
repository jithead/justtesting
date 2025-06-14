# justtesting

This is a small demo project showing how to build a basic website with user sign up and login functionality using only Node's built-in modules. It now includes optional email notifications when new questions are submitted.

## Running the server

Run the following command:

```bash
node server.js
```

The server listens on port 3000 by default. Open your browser and navigate to `http://localhost:3000` to access the site.

User data is stored in `users.json` in the project directory. When signing up
you must provide an email address. The server will send
notifications about new questions directed at that user when email support is
configured.

## Email notifications

If you want users to receive an email when someone submits a new question for them, create a `.env` file in the project directory (see `.env.example`) containing the following variables. If `.env` is missing, the following example credentials are applied automatically:

```
MAILGUN_API_KEY=6ec241281fb42e718fea838dbb1b0a95
MAILGUN_DOMAIN=sandboxd82a1d4c864349bb9a164c8342c7e511
```

Environment variables in `.env` are loaded automatically when the server starts.
When these are defined the server will send a message via [Mailgun](https://www.mailgun.com/) each time a question is posted.
