import type { Context } from "hono";
import {
    deleteAdminSession,
    insertAdminSession,
} from "../db";
import type { AppBindings } from "../types/env";
import { constantTimeEqual } from "../utils/compare";
import { generateSessionToken, getSessionExpiry, hashSessionToken } from "../utils/session";

const SESSION_DAYS = 7;

// POST /api/v1/auth — 管理员登录（单用户，用户名 + 密码）
export const auth = async (c: Context<AppBindings>) => {
    const body = await c.req.json<{ username?: string; password?: string }>().catch(() => null);

    if (!body?.username || !body?.password) {
        return c.json({
            code: 400,
            msg: "Username and password are required",
            data: null,
        });
    }

    const adminUsername = c.env.ADMIN_USERNAME;
    const adminPassword = c.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
        return c.json({
            code: 500,
            msg: "Admin credentials are not configured",
            data: null,
        });
    }

    // 用户名和密码都做常量时间比较，避免通过响应时间区分是哪一项错误。
    const usernameMatches = constantTimeEqual(body.username, adminUsername);
    const passwordMatches = constantTimeEqual(body.password, adminPassword);

    if (!usernameMatches || !passwordMatches) {
        return c.json({
            code: 401,
            msg: "Invalid username or password",
            data: null,
        });
    }

    const token = generateSessionToken();
    const tokenHash = await hashSessionToken(token);
    const expiresAt = getSessionExpiry(SESSION_DAYS);

    await insertAdminSession(c.env.DB, {
        id: crypto.randomUUID(),
        tokenHash,
        expiresAt,
    });

    return c.json({
        code: 200,
        msg: "OK",
        data: {
            token,
            expiresAt,
        },
    });
};

// POST /api/v1/logout — 退出登录，服务端删除会话
export const logout = async (c: Context<AppBindings>) => {
    const session = c.get("adminSession");

    if (session) {
        await deleteAdminSession(c.env.DB, session.id);
    }

    return c.json({
        code: 200,
        msg: "OK",
        data: null,
    });
};

// GET /api/v1/me — 校验当前会话是否有效
export const me = async (c: Context<AppBindings>) => {
    return c.json({
        code: 200,
        msg: "OK",
        data: {
            username: c.env.ADMIN_USERNAME ?? null,
        },
    });
};
