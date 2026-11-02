//! 正文里的附件引用：`![说明](ATT-xxx)` 或 `[说明](ATT-xxx)`。服务端校验、CLI 下载后改写都用这里的解析。

/// 按出现顺序返回去重后的附件 ID。
pub fn attachment_refs(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (_, id) in ref_spans(text) {
        if !out.iter().any(|x| x == id) {
            out.push(id.to_string());
        }
    }
    out
}

/// 把每个 `](ATT-xxx)` 中的 ID 交给 `f` 改写；`f` 返回 None 时保持原样。
pub fn rewrite_refs(text: &str, mut f: impl FnMut(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (start, id) in ref_spans(text) {
        if let Some(rep) = f(id) {
            out.push_str(&text[last..start]);
            out.push_str(&rep);
            last = start + id.len();
        }
    }
    out.push_str(&text[last..]);
    out
}

/// 返回 (ID 起始字节位置, ID)。
fn ref_spans(text: &str) -> Vec<(usize, &str)> {
    let mut spans = Vec::new();
    let mut from = 0;
    while let Some(pos) = text[from..].find("](ATT-") {
        let start = from + pos + 2;
        let rest = &text[start + 4..];
        let len = rest.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(rest.len());
        if len > 0 && rest[len..].starts_with(')') {
            spans.push((start, &text[start..start + 4 + len]));
        }
        from = start;
    }
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_rewrites() {
        let t = "看图 ![弹窗](ATT-ab12) 和 [日志](ATT-cd34)，再看 ![](ATT-ab12) 与 [x](ATT-) [y](http://a)";
        assert_eq!(attachment_refs(t), vec!["ATT-ab12", "ATT-cd34"]);
        let r = rewrite_refs(t, |id| (id == "ATT-ab12").then(|| "/tmp/a.png".to_string()));
        assert_eq!(r, "看图 ![弹窗](/tmp/a.png) 和 [日志](ATT-cd34)，再看 ![](/tmp/a.png) 与 [x](ATT-) [y](http://a)");
    }
}
