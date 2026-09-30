import type { Context } from "hono";
import type { AppBindings } from "../types/env";
import { deleteMailLogs, queryMailLogs } from "../db";

// 单个请求最多允许删除的日志条数，避免超出 D1 绑定参数上限。
const MAX_DELETE_IDS = 100;

export const logs = async (c: Context<AppBindings>) => {
    const email = c.req.query("email") || undefined;
    const page = parseInt(c.req.query("page") || "1", 10);
    const pageSize = parseInt(c.req.query("pageSize") || "10", 10);

    const result = await queryMailLogs(c.env.DB, {
        email,
        page,
        pageSize,
    });

    return c.json({
        code: 200,
        msg: "OK",
        data: result,
    });
};

// POST /api/v1/logs/delete — 按 id 批量删除日志
export const removeLogs = async (c: Context<AppBindings>) => {
    let body: { ids?: unknown };

    try {
        body = await c.req.json();
    } catch {
        return c.json({ code: 400, msg: "Invalid JSON body", data: null });
    }

    if (!Array.isArray(body?.ids) || body.ids.length === 0) {
        return c.json({ code: 400, msg: "ids must be a non-empty array", data: null });
    }

    if (!body.ids.every((id) => typeof id === "string" && id.trim())) {
        return c.json({ code: 400, msg: "ids must contain non-empty strings", data: null });
    }

    // 去重后再校验数量
    const ids = [...new Set((body.ids as string[]).map((id) => id.trim()))];

    if (ids.length > MAX_DELETE_IDS) {
        return c.json({
            code: 400,
            msg: `Too many ids, at most ${MAX_DELETE_IDS} per request`,
            data: null,
        });
    }

    const deleted = await deleteMailLogs(c.env.DB, ids);

    return c.json({
        code: 200,
        msg: "OK",
        data: { deleted },
    });
};
