use axum::extract::State;
use axum::Json;
use contract::dto::Meta;

use crate::app::AppState;

pub const API_VERSION: u32 = 1;
pub const MIN_CLI_VERSION: &str = "0.1.0";

pub async fn meta(State(st): State<AppState>) -> Json<Meta> {
    Json(Meta {
        server_version: st.server_version.to_string(),
        api_version: API_VERSION,
        min_cli_version: MIN_CLI_VERSION.to_string(),
    })
}
