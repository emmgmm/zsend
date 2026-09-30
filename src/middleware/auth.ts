import type { Context, Next } from "hono";
import {
    deleteExpiredAdminSessions,
    getAdminSessionByTokenHash,
    getApiKeyByKey,
    touchApiKeyLastUsed,
} from "../db";
import type { AppBindings } from "../types/env";
import { hashSessionToken } from "../utils/session";

const unauthorized = (c: Context<AppBindings>, msg: string) => {
    return c.json({
        code: 401,
        msg,
        data: null,
    });
};

// 从 Authorization 头中取出 Bearer token
const getBearerToken = (c: Context<AppBindings>) => {
    const header = c.req.header("Authorization");

    if (!header) {
        return null;
    }

    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
};

const isExpired = (expiresAt: string) => {
    return new Date(expiresAt).getTime() < Date.now();
};

// 管理员后台鉴权：只认登录签发的会话 token
export const adminAuth = () => {
    return async (c: Context<AppBindings>, next: Next) => {
        const token = getBearerToken(c);

        if (!token) {
            return unauthorized(c, "Authorization header is required");
        }

        const tokenHash = await hashSessionToken(token);

        try {
            const session = await getAdminSessionByTokenHash(c.env.DB, tokenHash);

            if (!session || isExpired(session.expires_at)) {
                return unauthorized(c, "Invalid or expired session");
            }

            c.set("adminSession", session);
        } catch {
            return unauthorized(c, "Failed to verify session");
        }

        // 顺手清理过期会话，不阻塞当前请求
        c.executionCtx.waitUntil(deleteExpiredAdminSessions(c.env.DB).catch(() => {}));

        await next();
    };
};

// 发信鉴权：管理员会话或 API 密钥均可用
export const sendAuth = () => {
    return async (c: Context<AppBindings>, next: Next) => {
        const token = getBearerToken(c);

        if (!token) {
            return unauthorized(c, "Authorization header is required");
        }

        try {
            // 先尝试管理员会话
            const tokenHash = await hashSessionToken(token);
            const session = await getAdminSessionByTokenHash(c.env.DB, tokenHash);

            if (session && !isExpired(session.expires_at)) {
                c.set("adminSession", session);
                c.set("authType", "admin");
                await next();
                return;
            }

            // 再尝试 API 密钥
            const apiKey = await getApiKeyByKey(c.env.DB, token);

            if (apiKey && apiKey.enabled === 1) {
                c.set("apiKey", apiKey);
                c.set("authType", "apikey");

                // 记录最近使用时间，失败不影响发信
                c.executionCtx.waitUntil(touchApiKeyLastUsed(c.env.DB, apiKey.id).catch(() => {}));

                await next();
                return;
            }
        } catch {
            return unauthorized(c, "Failed to verify credentials");
        }

        return unauthorized(c, "Invalid credentials");
    };
};
