//! Shared loopback OAuth redirect catcher for the desktop OAuth flows.
//!
//! The important detail: it listens on BOTH IPv4 (127.0.0.1) and IPv6 (::1)
//! loopback on the same port. On Windows especially, browsers resolve
//! `localhost` to `::1` first, so a listener bound only to 127.0.0.1 never
//! receives the redirect — the callback page comes up blank and the app hangs.
//! Binding both addresses fixes that regardless of how `localhost` resolves.

use std::time::{Duration, Instant};

const SUCCESS_HTML: &str = "<html><body style=\"font-family:sans-serif;padding:2rem\">\
    <h2>Connected</h2><p>You can close this window and return to Sonic the Ledgerhog.</p>\
    </body></html>";

/// Open `authorize_url` in the system browser, then catch the loopback redirect
/// to `/callback` on `port` and return the full request path+query (e.g.
/// "/callback?code=...&state=..."). Responds to the browser with a success page.
pub fn capture_redirect(port: u16, authorize_url: &str, timeout_secs: u64) -> Result<String, String> {
    // Bind both loopback families; keep whichever succeed (at least one required).
    let mut servers: Vec<tiny_http::Server> = Vec::new();
    if let Ok(s) = tiny_http::Server::http(("127.0.0.1", port)) {
        servers.push(s);
    }
    if let Ok(s) = tiny_http::Server::http(("::1", port)) {
        servers.push(s);
    }
    if servers.is_empty() {
        return Err(format!(
            "Could not start the local sign-in listener on port {port} (is it already in use?)."
        ));
    }

    webbrowser::open(authorize_url).map_err(|e| format!("could not open browser: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if Instant::now() >= deadline {
            return Err("Timed out waiting for authorization (5 min).".into());
        }
        for server in &servers {
            match server.recv_timeout(Duration::from_millis(250)) {
                Ok(Some(req)) => {
                    let url = req.url().to_string();
                    if url.starts_with("/callback") {
                        let resp = tiny_http::Response::from_string(SUCCESS_HTML).with_header(
                            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap(),
                        );
                        let _ = req.respond(resp);
                        return Ok(url);
                    }
                    // Ignore favicon or other stray requests.
                    let _ = req.respond(tiny_http::Response::from_string("Not found").with_status_code(404));
                }
                Ok(None) => {} // this family idle — try the next, then re-check deadline
                Err(e) => return Err(format!("listener error: {e}")),
            }
        }
    }
}
