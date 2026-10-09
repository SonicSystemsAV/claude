use serde_json::Value;

/// Proxy a Claude Messages API request from the desktop app's Rust side.
///
/// The webview can't call the Anthropic API directly (no CORS headers) and we
/// don't want the API key living in the web context. The React layer builds the
/// full request body and passes it here with the user's key; Rust makes the
/// HTTPS call and returns the parsed JSON response. Arg `api_key` is received as
/// `apiKey` from JS (Tauri camelCases command args).
#[tauri::command]
pub async fn assistant_chat(req: Value, api_key: String) -> Result<Value, String> {
    if api_key.trim().is_empty() {
        return Err("Missing Anthropic API key.".into());
    }
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("invalid JSON response: {e}"))?;

    if !status.is_success() {
        // Surface Anthropic's error payload (e.g. auth / rate-limit) to the UI.
        return Err(format!("Anthropic API error {}: {}", status.as_u16(), body));
    }
    Ok(body)
}
