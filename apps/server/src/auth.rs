use std::collections::HashSet;

use axum::extract::{FromRequestParts, RawPathParams};
use axum::http::request::Parts;
use axum::http::{Method, header};
use axum_extra::extract::CookieJar;
use contract::dto::{ActorType, Role};
use contract::error as code;
use sha2::{Digest, Sha256};
use sqlx::Row;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const SESSION_COOKIE: &str = "wtow_session";
pub const PAT_PREFIX: &str = "wtow_pat_";

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::fill(&mut buf[..]);
    hex::encode(buf)
}

pub fn sha256(s: &str) -> Vec<u8> {
    Sha256::digest(s.as_bytes()).to_vec()
}

pub fn role_str(r: Role) -> &'static str {
    match r {
        Role::Tester => "tester",
        Role::Assigner => "assigner",
        Role::Developer => "developer",
        Role::Admin => "admin",
    }
}

pub fn parse_role(s: &str) -> Option<Role> {
    match s {
        "tester" => Some(Role::Tester),
        "assigner" => Some(Role::Assigner),
        "developer" => Some(Role::Developer),
        "admin" => Some(Role::Admin),
        _ => None,
    }
}

pub fn parse_roles(v: Vec<String>) -> Vec<Role> {
    v.iter().filter_map(|s| parse_role(s)).collect()
}

pub fn roles_to_strings(v: &[Role]) -> Vec<String> {
    v.iter().map(|r| role_str(*r).to_string()).collect()
}

#[derive(Debug, Clone)]
pub struct RoleSet(HashSet<Role>);

impl RoleSet {
    pub fn new(roles: impl IntoIterator<Item = Role>) -> Self {
        Self(roles.into_iter().collect())
    }

    /// admin 隐含全部角色。
    pub fn has(&self, r: Role) -> bool {
        self.0.contains(&r) || self.0.contains(&Role::Admin)
    }

    pub fn intersect(&self, other: &RoleSet) -> RoleSet {
        let mut out = HashSet::new();
        for r in [Role::Tester, Role::Assigner, Role::Developer, Role::Admin] {
            let in_self = if r == Role::Admin {
                self.0.contains(&r)
            } else {
                self.has(r)
            };
            let in_other = if r == Role::Admin {
                other.0.contains(&r)
            } else {
                other.has(r)
            };
            if in_self && in_other {
                out.insert(r);
            }
        }
        RoleSet(out)
    }

    pub fn to_vec(&self) -> Vec<Role> {
        let mut v: Vec<Role> = self.0.iter().copied().collect();
        v.sort_by_key(|r| role_str(*r));
        v
    }
}

#[derive(Debug, Clone)]
pub struct TokenAuth {
    pub token_id: i64,
    pub project_id: i64,
    pub roles: RoleSet,
    pub read_only: bool,
    pub actor_type: ActorType,
}

/// 已认证的调用者：Web 会话或项目令牌。
#[derive(Debug, Clone)]
pub struct UserCtx {
    pub user_id: i64,
    pub token: Option<TokenAuth>,
    /// 超管在每个项目里都视为 admin，不需要 membership。
    pub is_superadmin: bool,
}

impl UserCtx {
    /// 超管面板只认 Web 会话：项目令牌的权限边界是单个项目，不能借它跨项目。
    pub fn require_superadmin(&self) -> AppResult<()> {
        if self.is_superadmin && self.token.is_none() {
            Ok(())
        } else {
            Err(AppError::forbidden(
                code::FORBIDDEN_ROLE,
                "requires superadmin",
            ))
        }
    }
}

impl FromRequestParts<AppState> for UserCtx {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> AppResult<Self> {
        if let Some(bearer) = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        {
            let row = sqlx::query(
                "UPDATE api_tokens SET last_used_at = now()
                  WHERE token_hash = $1 AND revoked_at IS NULL
                    AND (expires_at IS NULL OR expires_at > now())
              RETURNING id, project_id, user_id, roles::text[] AS roles, read_only,
                        actor_type::text AS actor_type,
                        (SELECT is_superadmin FROM users WHERE id = user_id) AS is_superadmin",
            )
            .bind(sha256(bearer.trim()))
            .fetch_optional(&st.db)
            .await?
            .ok_or_else(AppError::unauthenticated)?;
            let actor: String = row.get("actor_type");
            return Ok(UserCtx {
                user_id: row.get("user_id"),
                is_superadmin: row.get("is_superadmin"),
                token: Some(TokenAuth {
                    token_id: row.get("id"),
                    project_id: row.get("project_id"),
                    roles: RoleSet::new(parse_roles(row.get("roles"))),
                    read_only: row.get("read_only"),
                    actor_type: if actor == "human" {
                        ActorType::Human
                    } else {
                        ActorType::Agent
                    },
                }),
            });
        }

        let jar = CookieJar::from_headers(&parts.headers);
        let sid = jar
            .get(SESSION_COOKIE)
            .ok_or_else(AppError::unauthenticated)?
            .value()
            .to_string();
        if parts.method != Method::GET
            && parts.method != Method::HEAD
            && !parts.headers.contains_key("x-requested-with")
        {
            return Err(AppError::forbidden(
                code::FORBIDDEN_ROLE,
                "missing X-Requested-With header",
            ));
        }
        let row = sqlx::query(
            "SELECT s.user_id, u.is_superadmin FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.id = $1 AND s.expires_at > now()",
        )
        .bind(sha256(&sid))
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(AppError::unauthenticated)?;
        Ok(UserCtx {
            user_id: row.get("user_id"),
            token: None,
            is_superadmin: row.get("is_superadmin"),
        })
    }
}

#[derive(Debug, Clone)]
pub struct ProjectCtx {
    pub project_id: i64,
    pub slug: String,
    pub user_id: i64,
    pub token_id: Option<i64>,
    pub roles: RoleSet,
    pub read_only: bool,
    pub actor_type: ActorType,
    pub require_human_triage: bool,
    pub archived: bool,
}

impl ProjectCtx {
    pub fn require(&self, r: Role) -> AppResult<()> {
        if self.roles.has(r) {
            Ok(())
        } else {
            Err(AppError::forbidden(
                code::FORBIDDEN_ROLE,
                format!("requires role {}", role_str(r)),
            ))
        }
    }

    pub fn require_write(&self) -> AppResult<()> {
        if self.read_only {
            Err(AppError::forbidden(
                code::TOKEN_READ_ONLY,
                "token is read-only",
            ))
        } else {
            Ok(())
        }
    }
}

impl FromRequestParts<AppState> for ProjectCtx {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> AppResult<Self> {
        let user = UserCtx::from_request_parts(parts, st).await?;
        let params = RawPathParams::from_request_parts(parts, st)
            .await
            .map_err(|_| AppError::not_found("project"))?;
        let slug = params
            .iter()
            .find(|(k, _)| *k == "slug")
            .map(|(_, v)| v.to_string())
            .ok_or_else(|| AppError::not_found("project"))?;

        let row = sqlx::query(
            "SELECT p.id, p.require_human_triage, p.archived_at IS NOT NULL AS archived,
                    m.roles::text[] AS roles
               FROM projects p
               LEFT JOIN memberships m ON m.project_id = p.id AND m.user_id = $2
              WHERE p.slug = $1",
        )
        .bind(&slug)
        .bind(user.user_id)
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(|| AppError::not_found(format!("project {slug}")))?;
        let project_id: i64 = row.get("id");

        if let Some(t) = &user.token
            && t.project_id != project_id
        {
            return Err(AppError::forbidden(
                code::PROJECT_MISMATCH,
                format!("token does not belong to project {slug}"),
            ));
        }
        let member_roles: Option<Vec<String>> = row.get("roles");
        let member = if user.is_superadmin {
            RoleSet::new([Role::Admin])
        } else {
            RoleSet::new(parse_roles(
                member_roles.ok_or_else(|| AppError::not_found(format!("project {slug}")))?,
            ))
        };
        let (roles, read_only, actor_type, token_id) = match &user.token {
            Some(t) => (
                member.intersect(&t.roles),
                t.read_only,
                t.actor_type,
                Some(t.token_id),
            ),
            None => (member, false, ActorType::Human, None),
        };

        Ok(ProjectCtx {
            project_id,
            slug,
            user_id: user.user_id,
            token_id,
            roles,
            read_only,
            actor_type,
            require_human_triage: row.get("require_human_triage"),
            archived: row.get("archived"),
        })
    }
}

pub fn hash_password(pw: &str) -> AppResult<String> {
    use argon2::password_hash::PasswordHasher;
    argon2::Argon2::default()
        .hash_password(pw.as_bytes())
        .map(|h| h.to_string())
        .map_err(|_| AppError::validation("cannot hash password"))
}

pub fn verify_password(pw: &str, hash: &str) -> bool {
    use argon2::password_hash::{PasswordVerifier, phc::PasswordHash};
    PasswordHash::new(hash)
        .map(|h| {
            argon2::Argon2::default()
                .verify_password(pw.as_bytes(), &h)
                .is_ok()
        })
        .unwrap_or(false)
}
