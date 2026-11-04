use axum::Json;
use axum::extract::State;
use contract::dto::Meta;

use crate::state::AppState;

pub const API_VERSION: u32 = 1;
pub const MIN_CLI_VERSION: &str = "0.1.0";

pub async fn meta(State(st): State<AppState>) -> Json<Meta> {
    Json(Meta {
        server_version: st.server_version.to_string(),
        api_version: API_VERSION,
        min_cli_version: MIN_CLI_VERSION.to_string(),
    })
}

/// `GET /meta`：服务端版本与 CLI 兼容性。
pub fn router() -> axum::Router<AppState> {
    axum::Router::new().route("/meta", axum::routing::get(meta))
}
