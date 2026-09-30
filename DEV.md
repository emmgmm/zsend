# Development Guide

[README](./README.md) | [中文文档](./README.zh-CN.md)

This document covers local development, local configuration, and API debugging for ZSend.

## Requirements

- `bun`
- Cloudflare account
- Wrangler
- At least one working SMTP account
- A Cloudflare D1 database binding named `DB`

## Local Development

Install dependencies:

```bash
bun install
```

Create your local environment file:

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars` and fill in your local values for:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Start the local Worker dev server:

```bash
bun run dev
```

Notes:

- Wrangler loads local variables from `.dev.vars`
- `.dev.vars` is ignored by git and should stay local only
- `.dev.vars.example` is the template for other users and new environments
- Local dev port is fixed at `8000` in `wrangler.jsonc`
- The Worker entry is `src/index.ts`
- The project has no `test`, `lint`, or `typecheck` script configured right now

## Configuration

Current bindings used by the Worker:

| Binding | Type | Required | Description |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | string | Yes | Admin login username for the Web UI |
| `ADMIN_PASSWORD` | string | Yes | Admin login password (plain text) |
| `DB` | D1 binding | Yes | Stores mail logs, SMTP accounts, API keys, and admin sessions |

SMTP accounts and API keys are managed in the Web UI and stored in D1; they are no longer configured through environment variables.

The admin account is read from the `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables. To change the password, update the `ADMIN_PASSWORD` secret and redeploy.

### Local `.dev.vars` example

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-local-password
```

Files:

- `.dev.vars`: local-only real values
- `.dev.vars.example`: committed template without real secrets

## Authentication Model

There are two kinds of credentials:

- **Admin session**: `POST /api/v1/auth` verifies the username/password and returns a session token (valid for 7 days). The Web UI stores it in `sessionStorage` and sends it as `Authorization: Bearer <token>`. It protects the admin endpoints (logs, SMTP accounts, API keys) and can also be used to send mail from the Web UI.
- **API key**: created on the API Keys page (`sk-...` by default, or a custom value). It is only accepted by `POST /api/v1/send` and is recorded in the mail log.

`POST /api/v1/send` accepts either credential.

### API key management

- `GET /api/v1/keys` lists keys with the secret masked (`sk-a****wxyz`) in both the `key` and `key_masked` fields; the full value is never returned.
- `POST /api/v1/keys/:id/reveal` requires the admin password in the body (`{ "password": "..." }`) and returns the full key. The Web UI uses this for the View/Copy buttons.
- `POST /api/v1/keys` (create) is the only other response that contains the full key, so copy it right after creation.


## API Debugging

### Health Check

```http
GET /
```

Example response:

```json
{
  "code": 200,
  "msg": "Hello World!",
  "data": null
}
```

### Send Email

```http
POST /api/v1/send
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Request body:

```json
{
  "from": "no-reply@example.com",
  "to": "user@example.com",
  "title": "Welcome",
  "content": "# Hello\nThis message was sent by ZSend.",
  "type": "markdown",
  "sender_name": "ZSend Notifications"
}
```

Request fields:

- `from`: required, the server matches the sender against the SMTP accounts configured in the Web UI (by `from_email`, then by `username`)
- `to`: required, recipient email address
- `title`: required, mail subject
- `content`: required, mail body
- `type`: optional, one of `text`, `html`, `markdown`; defaults to `text`
- `sender_name`: optional, overrides the configured display name for this request

Example `curl`:

```bash
curl -X POST "http://127.0.0.1:8000/api/v1/send" \
  -H "Authorization: Bearer sk-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "no-reply@example.com",
    "to": "user@example.com",
    "title": "Welcome",
    "content": "# Hello\nThis message was sent by ZSend.",
    "type": "markdown",
    "sender_name": "ZSend Notifications"
  }'
```

Accepted response example:

```json
{
  "code": 200,
  "msg": "Email request accepted",
  "data": {
    "from": "no-reply@example.com",
    "to": "user@example.com",
    "title": "Welcome"
  }
}
```

Important behavior:

- Invalid or missing credentials (admin session or API key) returns `401`
- Invalid JSON body returns `400`
- Missing required fields returns `400`
- Unsupported `type` returns `400`
- If no SMTP config matches `from`, the API returns `400`
- The HTTP API returns after the request is accepted; sending and log writing continue in `waitUntil`
- SMTP sending is retried once after a 10 second delay if the first attempt fails

## Useful Commands

```bash
bun run dev
bun run deploy
bun run cf-typegen
```
