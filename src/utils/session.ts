// 生成随机会话 token 并计算其哈希；D1 里只存哈希，明文仅返回给前端一次。
const SESSION_TOKEN_BYTES = 32;

export const generateSessionToken = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

export const hashSessionToken = async (token: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
};

export const getSessionExpiry = (days = 7) => {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
};
