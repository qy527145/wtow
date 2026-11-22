-- 反馈自动携带的客户端上下文：Web 的 UA/视口/时区，CLI 的主机、系统与反馈终端标识。
ALTER TABLE raw_compositions ADD COLUMN client_context JSONB NOT NULL DEFAULT '{}'::jsonb;
