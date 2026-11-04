-- 超级管理员：跨项目可见、可操作，不依赖 memberships。初始名单来自 WTOW_SUPERADMIN_EMAILS。
ALTER TABLE users ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT false;
