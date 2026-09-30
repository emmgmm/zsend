import type { AdminSession, ApiKey, AppD1Database } from "../types/env";

const MAIL_LOGS_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS mail_logs (
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
);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_logs_created_at
ON mail_logs(created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_logs_to_email
ON mail_logs(to_email);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_logs_from_email
ON mail_logs(from_email);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_logs_status
ON mail_logs(status);`,
];

// 老版本的 mail_logs 表可能缺少后加的列，CREATE TABLE IF NOT EXISTS 不会补列，
// 这里通过 PRAGMA 检查后再 ALTER TABLE，保证升级时平滑迁移。
const ensureColumns = async (
    db: AppD1Database,
    table: string,
    columns: { name: string; definition: string }[]
) => {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const existing = new Set((info.results || []).map((row) => row.name));

    for (const column of columns) {
        if (!existing.has(column.name)) {
            await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`).run();
        }
    }
};

export const ensureMailLogsTable = async (db?: AppD1Database) => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    for (const statement of MAIL_LOGS_SCHEMA) {
        await db.prepare(statement.trim()).run();
    }

    await ensureColumns(db, "mail_logs", [{ name: "api_key_name", definition: "TEXT" }]);
};

type MailLogPayload = {
    fromEmail: string;
    toEmail: string;
    subject: string;
    senderName?: string;
    mailType: string;
    smtpUsername: string;
    status: "success" | "failed";
    errorMessage?: string;
    requestIp?: string | null;
    contentText?: string;
    apiKeyName?: string | null;
};

const createLogId = () => {
    return crypto.randomUUID();
};

const getCurrentTimestamp = () => {
    return new Date().toISOString();
};

export const insertMailLog = async (db: AppD1Database | undefined, payload: MailLogPayload) => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    // 日志写入保持扁平字段，方便后续直接按时间、状态、收发件地址做 SQL 查询。
    await db.prepare(
        `INSERT INTO mail_logs (
          id,
          created_at,
          from_email,
          to_email,
          subject,
          sender_name,
          mail_type,
          smtp_username,
          status,
          error_message,
          request_ip,
          content_text,
          api_key_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        createLogId(),
        getCurrentTimestamp(),
        payload.fromEmail,
        payload.toEmail,
        payload.subject,
        payload.senderName ?? null,
        payload.mailType,
        payload.smtpUsername,
        payload.status,
        payload.errorMessage ?? null,
        payload.requestIp ?? null,
        payload.contentText ?? null,
        payload.apiKeyName ?? null
    ).run();
};

export type MailLog = {
    id: string;
    created_at: string;
    from_email: string;
    to_email: string;
    subject: string;
    sender_name: string | null;
    mail_type: string;
    smtp_username: string;
    status: string;
    error_message: string | null;
    request_ip: string | null;
    content_text: string | null;
    api_key_name: string | null;
};

export type QueryMailLogsParams = {
    email?: string;
    page?: number;
    pageSize?: number;
};

export type QueryMailLogsResult = {
    items: MailLog[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
};

export const queryMailLogs = async (
    db: AppD1Database | undefined,
    params: QueryMailLogsParams
): Promise<QueryMailLogsResult> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 10;
    const offset = (page - 1) * pageSize;

    let countQuery = "SELECT COUNT(*) as total FROM mail_logs";
    let dataQuery = "SELECT * FROM mail_logs";
    const conditions: string[] = [];
    const bindings: string[] = [];

    if (params.email) {
        conditions.push("(from_email LIKE ? OR to_email LIKE ?)");
        bindings.push(`%${params.email}%`, `%${params.email}%`);
    }

    if (conditions.length > 0) {
        const whereClause = " WHERE " + conditions.join(" AND ");
        countQuery += whereClause;
        dataQuery += whereClause;
    }

    dataQuery += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const dataBindings = [...bindings, String(pageSize), String(offset)];

    const countResult = await db.prepare(countQuery).bind(...bindings).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const items = await db.prepare(dataQuery).bind(...dataBindings).all<MailLog>();

    return {
        items: items.results || [],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    };
};

// 按 id 批量删除日志；调用方需先校验 ids 非空且数量在安全范围内。
export const deleteMailLogs = async (db: AppD1Database | undefined, ids: string[]): Promise<number> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    if (ids.length === 0) {
        return 0;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const result = await db.prepare(`DELETE FROM mail_logs WHERE id IN (${placeholders})`).bind(...ids).run();
    return result.meta.changes;
};

// ─── SMTP 账号管理 ────────────────────────────────────────────

const SMTP_ACCOUNTS_SCHEMA = `
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
);`;

export const ensureSmtpAccountsTable = async (db?: AppD1Database) => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    await db.prepare(SMTP_ACCOUNTS_SCHEMA.trim()).run();
};

export type SmtpAccount = {
    id: string;
    host: string;
    port: number;
    username: string;
    password: string;
    from_email: string | null;
    sender_name: string | null;
    protocol: string | null;
    enabled: number;
    remark: string | null;
    created_at: string;
    updated_at: string;
};

export type SmtpAccountPayload = {
    host: string;
    port: number;
    username: string;
    password: string;
    fromEmail?: string;
    senderName?: string;
    protocol?: string;
    enabled?: number;
    remark?: string;
};

// 列出所有启用的 SMTP 账号，供发件时匹配
export const getAllEnabledSmtpAccounts = async (db: AppD1Database | undefined): Promise<SmtpAccount[]> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    const result = await db.prepare("SELECT * FROM smtp_accounts WHERE enabled = 1").all<SmtpAccount>();
    return result.results || [];
};

// 分页查询全部 SMTP 账号（含禁用的）
export const querySmtpAccounts = async (
    db: AppD1Database | undefined,
    page: number = 1,
    pageSize: number = 20
): Promise<{ items: SmtpAccount[]; total: number; page: number; pageSize: number; totalPages: number }> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    const p = page > 0 ? page : 1;
    const ps = pageSize > 0 ? pageSize : 20;
    const offset = (p - 1) * ps;

    const countResult = await db.prepare("SELECT COUNT(*) as total FROM smtp_accounts").first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const items = await db.prepare("SELECT * FROM smtp_accounts ORDER BY created_at DESC LIMIT ? OFFSET ?")
        .bind(ps, offset)
        .all<SmtpAccount>();

    return { items: items.results || [], total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
};

// 按 ID 查询单个账号
export const getSmtpAccountById = async (db: AppD1Database | undefined, id: string): Promise<SmtpAccount | null> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    return await db.prepare("SELECT * FROM smtp_accounts WHERE id = ?").bind(id).first<SmtpAccount>() ?? null;
};

// 新增 SMTP 账号
export const insertSmtpAccount = async (db: AppD1Database | undefined, payload: SmtpAccountPayload): Promise<SmtpAccount> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.prepare(
        `INSERT INTO smtp_accounts (id, host, port, username, password, from_email, sender_name, protocol, enabled, remark, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        payload.host,
        payload.port,
        payload.username,
        payload.password,
        payload.fromEmail ?? null,
        payload.senderName ?? null,
        payload.protocol ?? null,
        payload.enabled ?? 1,
        payload.remark ?? null,
        now,
        now
    ).run();

    return (await getSmtpAccountById(db, id))!;
};

// 更新 SMTP 账号（部分更新）
export const updateSmtpAccount = async (db: AppD1Database | undefined, id: string, payload: Partial<SmtpAccountPayload>): Promise<SmtpAccount | null> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    const existing = await getSmtpAccountById(db, id);
    if (!existing) return null;

    // 动态构建 SET 子句，只更新传入的字段
    const fields: string[] = [];
    const bindings: (string | number)[] = [];

    if (payload.host !== undefined) { fields.push("host = ?"); bindings.push(payload.host); }
    if (payload.port !== undefined) { fields.push("port = ?"); bindings.push(payload.port); }
    if (payload.username !== undefined) { fields.push("username = ?"); bindings.push(payload.username); }
    if (payload.password !== undefined) { fields.push("password = ?"); bindings.push(payload.password); }
    if (payload.fromEmail !== undefined) { fields.push("from_email = ?"); bindings.push(payload.fromEmail ?? ""); }
    if (payload.senderName !== undefined) { fields.push("sender_name = ?"); bindings.push(payload.senderName ?? ""); }
    if (payload.protocol !== undefined) { fields.push("protocol = ?"); bindings.push(payload.protocol ?? ""); }
    if (payload.enabled !== undefined) { fields.push("enabled = ?"); bindings.push(payload.enabled); }
    if (payload.remark !== undefined) { fields.push("remark = ?"); bindings.push(payload.remark ?? ""); }

    if (fields.length === 0) return existing;

    fields.push("updated_at = ?");
    bindings.push(new Date().toISOString());
    bindings.push(id);

    await db.prepare(`UPDATE smtp_accounts SET ${fields.join(", ")} WHERE id = ?`).bind(...bindings).run();

    return await getSmtpAccountById(db, id);
};

// 删除 SMTP 账号
export const deleteSmtpAccount = async (db: AppD1Database | undefined, id: string): Promise<boolean> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    const result = await db.prepare("DELETE FROM smtp_accounts WHERE id = ?").bind(id).run();
    return result.meta.changes > 0;
};

// ─── 发信密钥管理 ──────────────────────────────────────────────

const API_KEYS_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_key
ON api_keys(key);`,
];

export const ensureApiKeysTable = async (db?: AppD1Database) => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    for (const statement of API_KEYS_SCHEMA) {
        await db.prepare(statement.trim()).run();
    }
};

export type ApiKeyPayload = {
    key: string;
    name?: string | null;
    enabled?: number;
};

export const queryApiKeys = async (db: AppD1Database | undefined): Promise<ApiKey[]> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    const result = await db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all<ApiKey>();
    return result.results || [];
};

export const getApiKeyById = async (db: AppD1Database | undefined, id: string): Promise<ApiKey | null> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    return (await db.prepare("SELECT * FROM api_keys WHERE id = ?").bind(id).first<ApiKey>()) ?? null;
};

export const getApiKeyByKey = async (db: AppD1Database | undefined, key: string): Promise<ApiKey | null> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    return (await db.prepare("SELECT * FROM api_keys WHERE key = ?").bind(key).first<ApiKey>()) ?? null;
};

export const insertApiKey = async (db: AppD1Database | undefined, payload: ApiKeyPayload): Promise<ApiKey> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.prepare(
        `INSERT INTO api_keys (id, key, name, enabled, created_at, updated_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        payload.key,
        payload.name ?? null,
        payload.enabled ?? 1,
        now,
        now,
        null
    ).run();

    return (await getApiKeyById(db, id))!;
};

export const updateApiKey = async (
    db: AppD1Database | undefined,
    id: string,
    payload: Partial<ApiKeyPayload>
): Promise<ApiKey | null> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    const existing = await getApiKeyById(db, id);
    if (!existing) return null;

    const fields: string[] = [];
    const bindings: (string | number)[] = [];

    if (payload.key !== undefined) { fields.push("key = ?"); bindings.push(payload.key); }
    if (payload.name !== undefined) { fields.push("name = ?"); bindings.push(payload.name ?? ""); }
    if (payload.enabled !== undefined) { fields.push("enabled = ?"); bindings.push(payload.enabled); }

    if (fields.length === 0) return existing;

    fields.push("updated_at = ?");
    bindings.push(new Date().toISOString());
    bindings.push(id);

    await db.prepare(`UPDATE api_keys SET ${fields.join(", ")} WHERE id = ?`).bind(...bindings).run();

    return await getApiKeyById(db, id);
};

export const deleteApiKey = async (db: AppD1Database | undefined, id: string): Promise<boolean> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    const result = await db.prepare("DELETE FROM api_keys WHERE id = ?").bind(id).run();
    return result.meta.changes > 0;
};

// 记录密钥最近一次被使用的时间；失败不影响主流程，调用方自行兜底。
export const touchApiKeyLastUsed = async (db: AppD1Database | undefined, id: string): Promise<void> => {
    if (!db) return;
    await db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), id)
        .run();
};

// ─── 管理员会话 ────────────────────────────────────────────────

const ADMIN_SESSIONS_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);`,
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash
ON admin_sessions(token_hash);`,
    `CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
ON admin_sessions(expires_at);`,
];

export const ensureAdminSessionsTable = async (db?: AppD1Database) => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    for (const statement of ADMIN_SESSIONS_SCHEMA) {
        await db.prepare(statement.trim()).run();
    }
};

export const insertAdminSession = async (
    db: AppD1Database | undefined,
    payload: { id: string; tokenHash: string; expiresAt: string }
): Promise<void> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }

    await db.prepare(
        `INSERT INTO admin_sessions (id, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?)`
    ).bind(payload.id, payload.tokenHash, new Date().toISOString(), payload.expiresAt).run();
};

export const getAdminSessionByTokenHash = async (
    db: AppD1Database | undefined,
    tokenHash: string
): Promise<AdminSession | null> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    return (await db.prepare("SELECT * FROM admin_sessions WHERE token_hash = ?").bind(tokenHash).first<AdminSession>()) ?? null;
};

export const deleteAdminSession = async (db: AppD1Database | undefined, id: string): Promise<void> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(id).run();
};

// 清理过期会话，避免表无限增长。
export const deleteExpiredAdminSessions = async (db: AppD1Database | undefined): Promise<void> => {
    if (!db) {
        throw new Error("D1 binding DB is not configured");
    }
    await db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
};
