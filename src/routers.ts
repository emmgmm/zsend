import { Hono } from "hono";
import { index } from "./api/index";
import { send } from "./api/send";
import { auth, logout, me } from "./api/auth";
import { logs } from "./api/logs";
import { listKeys, createKey, updateKey, removeKey, revealKey } from "./api/keys";
import { listAccounts, getAccount, createAccount, updateAccount, removeAccount } from "./api/accounts";
import { indexPage } from "./pages/index";
import { adminAuth, sendAuth } from "./middleware/auth";
import type { AppBindings } from "./types/env";

export const router = new Hono<AppBindings>();

// ─── API 路由 ──────────────────────────────────────────────────

router.get("/api/health", index);

// 登录 / 退出 / 会话校验
router.post("/api/v1/auth", auth);
router.post("/api/v1/logout", adminAuth(), logout);
router.get("/api/v1/me", adminAuth(), me);

router.get("/api/v1/logs", adminAuth(), logs);

// 发信：管理员会话或 API 密钥均可
router.post("/api/v1/send", sendAuth(), send);

// 发信密钥管理（需管理员会话）
router.get("/api/v1/keys", adminAuth(), listKeys);
router.post("/api/v1/keys", adminAuth(), createKey);
router.post("/api/v1/keys/:id/reveal", adminAuth(), revealKey);
router.put("/api/v1/keys/:id", adminAuth(), updateKey);
router.delete("/api/v1/keys/:id", adminAuth(), removeKey);

// SMTP 账号管理（需管理员会话）
router.get("/api/v1/accounts", adminAuth(), listAccounts);
router.get("/api/v1/accounts/:id", adminAuth(), getAccount);
router.post("/api/v1/accounts", adminAuth(), createAccount);
router.put("/api/v1/accounts/:id", adminAuth(), updateAccount);
router.delete("/api/v1/accounts/:id", adminAuth(), removeAccount);

// ─── 前端 SPA catch-all ───────────────────────────────────────
// 所有非 API 路径统一返回 SPA HTML，由 Vue Router 在客户端处理路由
router.get("/*", (c) => {
    return c.html(indexPage().toString());
});
