// 常量时间字符串比较，避免通过响应时间推断敏感值是否匹配。
export const constantTimeEqual = (a: string, b: string) => {
    const aBytes = new TextEncoder().encode(a);
    const bBytes = new TextEncoder().encode(b);

    if (aBytes.length !== bBytes.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < aBytes.length; i += 1) {
        diff |= aBytes[i] ^ bBytes[i];
    }

    return diff === 0;
};
