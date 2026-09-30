CREATE TABLE IF NOT EXISTS mail_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  sender_name TEXT,
  mail_type TEXT NOT NULL,
  smtp_username TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  request_ip TEXT,
  content_text TEXT,
  api_key_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_mail_logs_created_at
ON mail_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_mail_logs_to_email
ON mail_logs(to_email);

CREATE INDEX IF NOT EXISTS idx_mail_logs_from_email
ON mail_logs(from_email);

CREATE INDEX IF NOT EXISTS idx_mail_logs_status
ON mail_logs(status);

CREATE TABLE IF NOT EXISTS smtp_accounts (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  from_email TEXT,
  sender_name TEXT,
  protocol TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key
ON api_keys(key);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash
ON admin_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
ON admin_sessions(expires_at);
