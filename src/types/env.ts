export type AppD1Statement = {
    bind: (...values: unknown[]) => AppD1Statement;
    first: <T = unknown>() => Promise<T | null>;
    all: <T = unknown>() => Promise<{ results?: T[] }>;
    run: () => Promise<{ meta: { changes: number } }>;
};

export type AppD1Database = {
    prepare: (query: string) => AppD1Statement;
};

export type AdminSession = {
    id: string;
    token_hash: string;
    created_at: string;
    expires_at: string;
};

export type ApiKey = {
    id: string;
    key: string;
    name: string | null;
    enabled: number;
    created_at: string;
    updated_at: string;
    last_used_at: string | null;
};

export type AppBindings = {
    Bindings: {
        DB?: AppD1Database;
        ADMIN_USERNAME?: string;
        ADMIN_PASSWORD?: string;
    };
    Variables: {
        adminSession?: AdminSession;
        authType?: "admin" | "apikey";
        apiKey?: ApiKey;
    };
};
