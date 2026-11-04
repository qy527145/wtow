/**
 * 与 Rust 端对齐的类型契约。
 *
 * `bindings/` 由 ts-rs 从 crates/contract 生成（`bun run gen:types`），是线格式的唯一来源，不要手改；
 * 需要收窄类型时在 Rust 侧用 `#[ts(type = "...")]` 表达。
 */

export type * from "./bindings";
