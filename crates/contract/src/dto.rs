use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Tester,
    Assigner,
    Developer,
    Admin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ActorType {
    Human,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Meta {
    pub server_version: String,
    pub api_version: u32,
    pub min_cli_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RegisterReq {
    pub email: String,
    pub display_name: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct User {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    #[serde(default)]
    pub is_superadmin: bool,
}

/// 超管面板里的项目行：带上跨项目才需要的统计。
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdminProject {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub archived: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub creator: String,
    pub member_count: i64,
    pub raw_total: i64,
    pub raw_pending: i64,
    pub exec_total: i64,
    pub exec_open: i64,
    pub last_activity_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdminUser {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub is_superadmin: bool,
    pub project_count: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdminUpdateUserReq {
    pub is_superadmin: Option<bool>,
    /// 重置密码；同时让该用户的所有会话失效。
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateMeReq {
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateProjectReq {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Project {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub require_human_triage: bool,
    pub archived: bool,
    pub my_roles: Vec<Role>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateProjectReq {
    pub name: Option<String>,
    pub description: Option<String>,
    pub require_human_triage: Option<bool>,
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Member {
    pub user_id: i64,
    pub email: String,
    pub display_name: String,
    pub roles: Vec<Role>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpsertMemberReq {
    pub email: String,
    pub roles: Vec<Role>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTokenReq {
    pub name: String,
    pub roles: Vec<Role>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default = "default_agent")]
    pub actor_type: ActorType,
    pub expires_in_days: Option<i64>,
}

fn default_agent() -> ActorType {
    ActorType::Agent
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Token {
    pub id: i64,
    pub name: String,
    pub prefix: String,
    pub roles: Vec<Role>,
    pub read_only: bool,
    pub actor_type: ActorType,
    pub revoked: bool,
    pub user_id: i64,
    /// 持有者显示名，管理员查看全部令牌时用来区分。
    pub owner: String,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreatedToken {
    #[serde(flatten)]
    pub token: Token,
    /// 明文只在创建时返回一次。
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WhoAmI {
    pub id: i64,
    pub email: String,
    pub project: String,
    pub roles: Vec<Role>,
    pub actor_type: ActorType,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum RawStatus {
    Pending,
    Claimed,
    Processed,
    Merged,
    Duplicate,
    Ignored,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    None,
    InProgress,
    Delivered,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SubmitRawReq {
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Attachment {
    pub id: String,
    pub filename: String,
    pub mime: String,
    pub size_bytes: i64,
    /// 附件所属作文。执行作文详情会带上来源原始作文的附件，靠它区分出处。
    #[serde(default)]
    pub owner_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RawComposition {
    pub id: String,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub status: RawStatus,
    pub reporter_id: i64,
    pub claimed_by: Option<i64>,
    pub claimed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub merged_into_id: Option<String>,
    pub triage_reason: Option<String>,
    pub version: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub delivery: Delivery,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ListRawQuery {
    pub status: Option<RawStatus>,
    pub tag: Option<String>,
    pub q: Option<String>,
    pub mine: Option<bool>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ExecStatus {
    Queued,
    InProgress,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateExecReq {
    pub source_raw_ids: Vec<String>,
    pub instruction: String,
    #[serde(default)]
    pub target_resources: Vec<String>,
    pub priority: Option<i16>,
    pub developer_id: Option<i64>,
    #[serde(default)]
    pub close_sources: bool,
    #[serde(default)]
    pub skip_related_check: bool,
    #[serde(default)]
    pub attachment_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExecComposition {
    pub id: String,
    pub instruction: String,
    pub target_resources: Vec<String>,
    pub status: ExecStatus,
    pub priority: i16,
    pub assigner_id: i64,
    pub developer_id: Option<i64>,
    pub claimed_at: Option<chrono::DateTime<chrono::Utc>>,
    pub developer_notes: Option<String>,
    #[ts(type = "string[] | null")]
    pub result_links: serde_json::Value,
    pub version: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub completed_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    pub source_raw_ids: Vec<String>,
    /// 自身附件在前，随后是各来源原始作文的附件。
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ListExecQuery {
    pub status: Option<ExecStatus>,
    pub developer_id: Option<i64>,
    pub target: Option<String>,
    pub q: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TriageReq {
    pub target_id: Option<String>,
    pub reason: String,
    #[serde(default)]
    pub skip_related_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ReasonReq {
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PatchRawReq {
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RelatedItem {
    /// "raw" 或 "exec"。
    #[ts(type = "\"raw\" | \"exec\"")]
    pub kind: String,
    pub id: String,
    pub title: String,
    pub status: String,
    pub score: f64,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClaimExecQuery {
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CompleteExecReq {
    pub developer_notes: String,
    #[serde(default)]
    pub result_links: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CancelExecReq {
    pub reason: String,
    #[serde(default = "default_true")]
    pub requeue_sources: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PatchExecReq {
    pub instruction: Option<String>,
    pub priority: Option<i16>,
    pub target_resources: Option<Vec<String>>,
    pub developer_notes: Option<String>,
    pub result_links: Option<Vec<String>>,
}
