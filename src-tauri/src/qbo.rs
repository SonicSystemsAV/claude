//! QuickBooks Online OAuth + API proxy for the desktop shell.
//!
//! Mirrors square.rs: a loopback authorization-code flow and an authenticated
//! API helper, both synchronous (Tauri runs them off the UI thread) using
//! reqwest's blocking client. Intuit's token endpoint uses HTTP Basic auth with
//! the app's client id/secret and form-encoded bodies; the company id (realmId)
//! arrives as a query param on the OAuth redirect, not in the token response.

use std::time::Duration;

use serde_json::{json, Value};

const TOKEN_URL: &str = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const AUTHORIZE_URL: &str = "https://appcenter.intuit.com/connect/oauth2";
const SCOPE: &str = "com.intuit.quickbooks.accounting";

fn api_base(environment: &str) -> &'static str {
    if environment == "production" {
        "https://quickbooks.api.intuit.com"
    } else {
        "https://sandbox-quickbooks.api.intuit.com"
    }
}

/// Run QuickBooks' authorization-code OAuth flow. Returns the token response
/// merged with `realm_id` (the connected company id).
#[tauri::command]
pub fn qbo_oauth(
    client_id: String,
    client_secret: String,
    redirect_port: u16,
) -> Result<Value, String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("QuickBooks Client ID and secret are required.".into());
    }
    let redirect_uri = format!("http://localhost:{redirect_port}/callback");
    let state = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );

    let authorize_url = reqwest::Url::parse_with_params(
        AUTHORIZE_URL,
        &[
            ("client_id", client_id.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("redirect_uri", redirect_uri.as_str()),
            ("state", state.as_str()),
        ],
    )
    .map_err(|e| format!("bad authorize URL: {e}"))?;

    let server = tiny_http::Server::http(("127.0.0.1", redirect_port))
        .map_err(|e| format!("could not start local listener on port {redirect_port}: {e}"))?;
    webbrowser::open(authorize_url.as_str()).map_err(|e| format!("could not open browser: {e}"))?;

    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    let (code, realm_id, got_state) = loop {
        if std::time::Instant::now() >= deadline {
            return Err("Timed out waiting for QuickBooks authorization (5 min).".into());
        }
        match server.recv_timeout(Duration::from_secs(2)) {
            Ok(Some(req)) => {
                let url = req.url().to_string();
                if !url.starts_with("/callback") {
                    let _ = req.respond(tiny_http::Response::from_string("Not found").with_status_code(404));
                    continue;
                }
                let parsed = reqwest::Url::parse(&format!("http://localhost{url}"))
                    .map_err(|e| format!("bad redirect URL: {e}"))?;
                let mut code: Option<String> = None;
                let mut realm: Option<String> = None;
                let mut st: Option<String> = None;
                let mut err: Option<String> = None;
                for (k, v) in parsed.query_pairs() {
                    match k.as_ref() {
                        "code" => code = Some(v.into_owned()),
                        "realmId" => realm = Some(v.into_owned()),
                        "state" => st = Some(v.into_owned()),
                        "error" => err = Some(v.into_owned()),
                        _ => {}
                    }
                }
                let page = "<html><body style=\"font-family:sans-serif;padding:2rem\">\
                    <h2>QuickBooks connected</h2><p>You can close this window and return to Sonic the Ledgerhog.</p>\
                    </body></html>";
                let resp = tiny_http::Response::from_string(page).with_header(
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap(),
                );
                let _ = req.respond(resp);
                if let Some(e) = err {
                    return Err(format!("QuickBooks authorization denied: {e}"));
                }
                match (code, realm) {
                    (Some(c), Some(r)) => break (c, r, st.unwrap_or_default()),
                    (Some(_), None) => return Err("QuickBooks redirect missing realmId (company id).".into()),
                    _ => return Err("QuickBooks redirect missing authorization code.".into()),
                }
            }
            Ok(None) => continue,
            Err(e) => return Err(format!("listener error: {e}")),
        }
    };

    if got_state != state {
        return Err("OAuth state mismatch — aborting for safety.".into());
    }

    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .basic_auth(&client_id, Some(&client_secret))
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .map_err(|e| format!("token exchange failed: {e}"))?;
    let status = resp.status();
    let mut body: Value = resp.json().map_err(|e| format!("invalid token JSON: {e}"))?;
    if !status.is_success() {
        return Err(format!("QuickBooks token error {}: {}", status.as_u16(), body));
    }
    if let Value::Object(ref mut map) = body {
        map.insert("realm_id".into(), json!(realm_id));
    }
    Ok(body)
}

/// Exchange a stored refresh token for a fresh access token.
#[tauri::command]
pub fn qbo_oauth_refresh(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<Value, String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() || refresh_token.trim().is_empty() {
        return Err("Missing QuickBooks credentials or refresh token.".into());
    }
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(TOKEN_URL)
        .basic_auth(&client_id, Some(&client_secret))
        .header("Accept", "application/json")
        .form(&[("grant_type", "refresh_token"), ("refresh_token", refresh_token.as_str())])
        .send()
        .map_err(|e| format!("token refresh failed: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().map_err(|e| format!("invalid token JSON: {e}"))?;
    if !status.is_success() {
        return Err(format!("QuickBooks token refresh error {}: {}", status.as_u16(), body));
    }
    Ok(body)
}

/// Authenticated QuickBooks API GET. `path` is like
/// "/v3/company/{realmId}/reports/GeneralLedger?start_date=...".
#[tauri::command]
pub fn qbo_api(environment: String, access_token: String, path: String) -> Result<Value, String> {
    if access_token.trim().is_empty() {
        return Err("Not connected to QuickBooks (no access token).".into());
    }
    let url = format!("{}{}", api_base(&environment), path);
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().map_err(|e| format!("invalid JSON response: {e}"))?;
    if !status.is_success() {
        return Err(format!("QuickBooks API error {}: {}", status.as_u16(), body));
    }
    Ok(body)
}
