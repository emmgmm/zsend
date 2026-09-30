import type { Context } from "hono";
import {
    deleteApiKey,
    getApiKeyById,
    getApiKeyByKey,
    insertApiKey,
    queryApiKeys,
    updateApiKey,
} from "../db";
import type { ApiKey, AppBindings } from "../types/env";
import { constantTimeEqual } from "../utils/compare";

const KEY_PREFIX = "sk-";
const KEY_RANDOM_BYTES = 24;

// 自动生成带前缀的随机密钥，使用 base64url 字符集，方便直接放进请求头。
const generateApiKey = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(KEY_RANDOM_BYTES));
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    const random = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    return KEY_PREFIX + random;
};

// 列表展示用的掩码：保留首 4 位和末 4 位，中间用 **** 覆盖；过短的 key 整段隐藏。
const maskKey = (key: string) => {
    if (key.length <= 8) {
        return "****";
    }
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
};

// 列表接口只返回掩码，不下发明文，完整密钥需通过 reveal 接口二次验证后获取。
const toMaskedKey = (apiKey: ApiKey) => ({
    ...apiKey,
    key: maskKey(apiKey.key),
    key_masked: maskKey(apiKey.key),
});

// GET /api/v1/keys — 密钥列表（脱敏展示）
export const listKeys = async (c: Context<AppBindings>) => {
    const keys = await queryApiKeys(c.env.DB);

    return c.json({
        code: 200,
        msg: "ok",
        data: {
            items: keys.map(toMaskedKey),
        },
    });
};

// POST /api/v1/keys — 新增密钥；key 留空则自动生成，填了则使用手填值（兼容迁移旧密钥）
export const createKey = async (c: Context<AppBindings>) => {
    let body: Record<string, unknown>;

    try {
        body = await c.req.json();
    } catch {
        return c.json({ code: 400, msg: "Invalid JSON body", data: null });
    }

    const providedKey = typeof body.key === "string" ? body.key.trim() : "";
    const key = providedKey || generateApiKey();

    const existing = await getApiKeyByKey(c.env.DB, key);
    if (existing) {
        return c.json({ code: 409, msg: "This key already exists", data: null });
    }

    const created = await insertApiKey(c.env.DB, {
        key,
        name: body.name ? String(body.name) : null,
        enabled: body.enabled !== undefined ? Number(body.enabled) : 1,
    });

    return c.json({ code: 200, msg: "Key created", data: created });
};

// PUT /api/v1/keys/:id — 更新备注 / 启停 / 修改 key
export const updateKey = async (c: Context<AppBindings>) => {
    const id = c.req.param("id");
    if (!id) {
        return c.json({ code: 400, msg: "Missing key id", data: null });
    }

    let body: Record<string, unknown>;

    try {
        body = await c.req.json();
    } catch {
        return c.json({ code: 400, msg: "Invalid JSON body", data: null });
    }

    const allowedFields = ["key", "name", "enabled"];
    const hasValidField = allowedFields.some((f) => body[f] !== undefined);

    if (!hasValidField) {
        return c.json({ code: 400, msg: "No valid fields to update", data: null });
    }

    const payload: Record<string, unknown> = {};
    if (body.key !== undefined) {
        const key = String(body.key).trim();
        if (!key) {
            return c.json({ code: 400, msg: "Key cannot be empty", data: null });
        }
        const conflict = await getApiKeyByKey(c.env.DB, key);
        if (conflict && conflict.id !== id) {
            return c.json({ code: 409, msg: "This key already exists", data: null });
        }
        payload.key = key;
    }
    if (body.name !== undefined) payload.name = body.name ? String(body.name) : null;
    if (body.enabled !== undefined) payload.enabled = Number(body.enabled);

    const updated = await updateApiKey(c.env.DB, id, payload);

    if (!updated) {
        return c.json({ code: 404, msg: "Key not found", data: null });
    }

    return c.json({ code: 200, msg: "Key updated", data: toMaskedKey(updated) });
};

// POST /api/v1/keys/:id/reveal — 二次验证管理员密码后返回完整密钥
export const revealKey = async (c: Context<AppBindings>) => {
    const id = c.req.param("id");
    if (!id) {
        return c.json({ code: 400, msg: "Missing key id", data: null });
    }

    let body: { password?: string };

    try {
        body = await c.req.json();
    } catch {
        return c.json({ code: 400, msg: "Invalid JSON body", data: null });
    }

    if (!body?.password) {
        return c.json({ code: 400, msg: "Password is required", data: null });
    }

    const adminPassword = c.env.ADMIN_PASSWORD;

    if (!adminPassword) {
        return c.json({ code: 500, msg: "Admin credentials are not configured", data: null });
    }

    if (!constantTimeEqual(body.password, adminPassword)) {
        return c.json({ code: 401, msg: "Invalid password", data: null });
    }

    const apiKey = await getApiKeyById(c.env.DB, id);

    if (!apiKey) {
        return c.json({ code: 404, msg: "Key not found", data: null });
    }

    return c.json({ code: 200, msg: "ok", data: { key: apiKey.key } });
};

// DELETE /api/v1/keys/:id — 删除密钥
export const removeKey = async (c: Context<AppBindings>) => {
    const id = c.req.param("id");
    if (!id) {
        return c.json({ code: 400, msg: "Missing key id", data: null });
    }

    const existing = await getApiKeyById(c.env.DB, id);
    if (!existing) {
        return c.json({ code: 404, msg: "Key not found", data: null });
    }

    await deleteApiKey(c.env.DB, id);

    return c.json({ code: 200, msg: "Key deleted", data: null });
};
