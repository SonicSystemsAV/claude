//! Square OAuth + API proxy for the desktop shell.
//!
//! The webview can't talk to Square directly (no CORS) and the OAuth flow needs
//! a local redirect listener, so both run here in Rust:
//!   • `square_oauth` runs the authorization-code flow against a loopback
//!     redirect and exchanges the code for tokens.
//!   • `square_api` makes authenticated calls (payments, orders, payouts).
//!
//! These are synchronous Tauri commands (Tauri runs them off the UI thread), so
//! they use reqwest's blocking client and a small blocking loopback server.

use std::time::Duration;

use serde_json::{json, Value};

const SQUARE_VERSION: &str = "2025-01-23";

fn api_base(environment: &str) -> &'static str {
    if environment == "production" {
        "https://connect.squareup.com"
    } else {
        "https://connect.squareupsandbox.com"
    }
}

/// Run Square's authorization-code OAuth flow and return the token response.
///
/// Opens the system browser to Square's consent page, catches the redirect on
/// `http://localhost:<redirect_port>/callback`, and exchanges the code for
/// tokens. The returned JSON is Square's `/oauth2/token` body (access_token,
/// refresh_token, expires_at, merchant_id, …). The redirect URI must be
/// registered verbatim in the Square developer dashboard.
#[tauri::command]
pub fn square_oauth(
    client_id: String,
    client_secret: String,
    environment: String,
    redirect_port: u16,
    scopes: String,
) -> Result<Value, String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err("Square Application ID and secret are required.".into());
    }
    let base = api_base(&environment);
    let redirect_uri = format!("http://localhost:{redirect_port}/callback");
    // CSRF nonce tying the browser round-trip to this request.
    let state = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );

    let authorize_url = reqwest::Url::parse_with_params(
        &format!("{base}/oauth2/authorize"),
        &[
            ("client_id", client_id.as_str()),
            ("response_type", "code"),
            ("scope", scopes.as_str()),
            ("session", "false"),
            ("state", state.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ],
    )
    .map_err(|e| format!("bad authorize URL: {e}"))?;

    // Start the loopback listener BEFORE opening the browser so we can't miss
    // the redirect.
    let server = tiny_http::Server::http(("127.0.0.1", redirect_port))
        .map_err(|e| format!("could not start local listener on port {redirect_port}: {e}"))?;

    webbrowser::open(authorize_url.as_str())
        .map_err(|e| format!("could not open browser: {e}"))?;

    // Wait (bounded) for Square to redirect back with ?code=...&state=...
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    let (code, got_state) = loop {
        if std::time::Instant::now() >= deadline {
            return Err("Timed out waiting for Square authorization (5 min).".into());
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
                let mut st: Option<String> = None;
                let mut err: Option<String> = None;
                for (k, v) in parsed.query_pairs() {
                    match k.as_ref() {
                        "code" => code = Some(v.into_owned()),
                        "state" => st = Some(v.into_owned()),
                        "error" => err = Some(v.into_owned()),
                        _ => {}
                    }
                }
                let body = "<html><body style=\"font-family:sans-serif;padding:2rem\">\
                    <h2>Square connected</h2><p>You can close this window and return to Sonic the Ledgerhog.</p>\
                    </body></html>";
                let resp = tiny_http::Response::from_string(body).with_header(
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap(),
                );
                let _ = req.respond(resp);
                if let Some(e) = err {
                    return Err(format!("Square authorization denied: {e}"));
                }
                match code {
                    Some(c) => break (c, st.unwrap_or_default()),
                    None => return Err("Square redirect missing authorization code.".into()),
                }
            }
            Ok(None) => continue, // timeout tick — loop and re-check the deadline
            Err(e) => return Err(format!("listener error: {e}")),
        }
    };

    if got_state != state {
        return Err("OAuth state mismatch — aborting for safety.".into());
    }

    // Exchange the code for tokens.
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("{base}/oauth2/token"))
        .header("Square-Version", SQUARE_VERSION)
        .json(&json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }))
        .send()
        .map_err(|e| format!("token exchange failed: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().map_err(|e| format!("invalid token JSON: {e}"))?;
    if !status.is_success() {
        return Err(format!("Square token error {}: {}", status.as_u16(), body));
    }
    Ok(body)
}

/// Exchange a stored refresh token for a fresh access token.
#[tauri::command]
pub fn square_oauth_refresh(
    client_id: String,
    client_secret: String,
    environment: String,
    refresh_token: String,
) -> Result<Value, String> {
    if client_id.trim().is_empty() || client_secret.trim().is_empty() || refresh_token.trim().is_empty() {
        return Err("Missing Square credentials or refresh token.".into());
    }
    let base = api_base(&environment);
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("{base}/oauth2/token"))
        .header("Square-Version", SQUARE_VERSION)
        .json(&json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }))
        .send()
        .map_err(|e| format!("token refresh failed: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().map_err(|e| format!("invalid token JSON: {e}"))?;
    if !status.is_success() {
        return Err(format!("Square token refresh error {}: {}", status.as_u16(), body));
    }
    Ok(body)
}

/// Make an authenticated Square API call and return the parsed JSON.
/// `method` is "GET" or "POST"; `path` is like "/v2/payments?begin_time=...".
#[tauri::command]
pub fn square_api(
    environment: String,
    access_token: String,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    if access_token.trim().is_empty() {
        return Err("Not connected to Square (no access token).".into());
    }
    let url = format!("{}{}", api_base(&environment), path);
    let client = reqwest::blocking::Client::new();
    let mut req = match method.to_uppercase().as_str() {
        "POST" => client.post(url),
        _ => client.get(url),
    }
    .header("Authorization", format!("Bearer {access_token}"))
    .header("Square-Version", SQUARE_VERSION)
    .header("Content-Type", "application/json");
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let body: Value = resp.json().map_err(|e| format!("invalid JSON response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Square API error {}: {}", status.as_u16(), body));
    }
    Ok(body)
}
