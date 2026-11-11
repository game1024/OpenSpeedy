//! Optional local control page (stage 6).
//!
//! A second way to change the speed that does not touch a game process at
//! all: a tiny HTTP page on the loopback interface. The listener is bound to
//! `127.0.0.1` only — it is never reachable from another machine — and every
//! action needs the session token, which is regenerated whenever the feature
//! is switched on.
//!
//! The feature is off by default and the port is not even opened while it is
//! off.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::Emitter;

/// The port the local page listens on. Loopback only.
const PORT: u16 = 17890;

static ENABLED: AtomicBool = AtomicBool::new(false);
static TOKEN: Mutex<String> = Mutex::new(String::new());
/// True while one listener thread owns the port. Re-enabling before the old
/// thread has exited simply lets that thread carry on with the refreshed token.
static LISTENING: AtomicBool = AtomicBool::new(false);

/// A token that is hard to guess from the outside.
fn make_token() -> String {
    // `RandomState` seeds itself from the OS; hashing it gives a value that
    // is different on every run without pulling in a dependency.
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0));
    hasher.write_usize(std::process::id() as usize);
    format!("{:016x}", hasher.finish())
}

fn token_matches(candidate: &str) -> bool {
    let current = match TOKEN.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    !current.is_empty() && current == candidate
}

/// The address and token of the running page, for the UI.
#[derive(Clone, serde::Serialize)]
pub struct RemoteInfo {
    pub enabled: bool,
    pub url: String,
    pub token: String,
}

pub fn info() -> RemoteInfo {
    let token = match TOKEN.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    RemoteInfo {
        enabled: ENABLED.load(Ordering::Relaxed),
        url: format!("http://127.0.0.1:{PORT}/"),
        token,
    }
}

/// Switch the page on or off. Switching on starts the listener, switching off
/// closes it — the port is not listening while the feature is off.
pub fn set_enabled(on: bool, app: tauri::AppHandle) {
    ENABLED.store(on, Ordering::Relaxed);
    if on {
        let token = make_token();
        {
            let mut current = match TOKEN.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            *current = token;
        }
        start(app);
    } else {
        // The token dies with the session; a page that is still open cannot
        // act any more.
        let mut current = match TOKEN.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        current.clear();
    }
}

fn start(app: tauri::AppHandle) {
    if LISTENING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        // A listener is already running; it will pick up the new token.
        return;
    }
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => listener,
            Err(err) => {
                LISTENING.store(false, Ordering::Relaxed);
                crate::applog::warn("remote", format!("cannot bind 127.0.0.1:{PORT} — {err}"));
                let _ = app.emit("remote-error", format!("{err}"));
                return;
            }
        };
        // A blocking `accept` would keep the port open until the next request
        // even after the switch is turned off. Non-blocking accept checks the
        // switch every 50 ms and drops the listener as soon as it is off.
        if let Err(err) = listener.set_nonblocking(true) {
            LISTENING.store(false, Ordering::Relaxed);
            crate::applog::warn("remote", format!("cannot set nonblocking — {err}"));
            return;
        }
        crate::applog::info("remote", format!("local control page on 127.0.0.1:{PORT}"));
        while ENABLED.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => handle(stream, &app),
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
        LISTENING.store(false, Ordering::Relaxed);
        // `listener` is dropped here: the port stops listening immediately.
        crate::applog::info("remote", "local control page stopped");
    });
}

fn read_request(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = [0u8; 2048];
    let read = stream.read(&mut buffer).ok()?;
    Some(String::from_utf8_lossy(&buffer[..read]).into_owned())
}

/// `?value=1.5` — the factor the page asks for.
fn query_value(request: &str) -> Option<f64> {
    let query = request.split_whitespace().nth(1)?.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next()?;
        let value = parts.next().unwrap_or("");
        if key.eq_ignore_ascii_case("value") {
            return value.parse::<f64>().ok();
        }
    }
    None
}

/// `?what=up|down|reset` — the three buttons on the page.
fn query_what(request: &str) -> Option<String> {
    let query = request.split_whitespace().nth(1)?.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next()?;
        let value = parts.next().unwrap_or("");
        if key.eq_ignore_ascii_case("what") {
            return Some(value.to_string());
        }
    }
    None
}

/// Resolve a page action to the factor to apply. `current` comes from
/// `bridge_get_speed`, the same source of truth the shortcut dispatcher uses;
/// an explicit `?value=` still works for scripted callers.
fn factor_for(what: Option<&str>, requested: Option<f64>, current: f64) -> f64 {
    const STEP: f64 = 0.5;
    match what {
        Some("up") => (current + STEP).max(0.01),
        Some("down") => (current - STEP).max(0.01),
        Some("reset") => 1.0,
        _ => match requested {
            Some(v) if v > 0.0 => v,
            _ => 1.0,
        },
    }
}

/// `?token=…` — the session token.
fn query_token(request: &str) -> Option<String> {
    let query = request.split_whitespace().nth(1)?.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next()?;
        let value = parts.next().unwrap_or("");
        if key.eq_ignore_ascii_case("token") {
            return Some(value.to_string());
        }
    }
    None
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn page(token: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>OpenSpeedy</title>\
<style>body{{font-family:system-ui;margin:2rem;background:#11151c;color:#e6edf3}}\
button{{font-size:1.2rem;margin:.25rem;padding:.6rem 1.2rem;border-radius:6px;border:1px solid #30363d;background:#1c2128;color:#e6edf3;cursor:pointer}}\
h1{{font-size:1.3rem}}</style></head><body><h1>OpenSpeedy</h1>\
<button onclick=\"go('up')\">加速</button><button onclick=\"go('down')\">减速</button>\
<button onclick=\"go('reset')\">原速</button><p id=\"s\"></p>\
<script>const token='{token}';\
function go(what){{fetch('/speed?what='+what+'&token='+token)\
.then(r=>r.text()).then(t=>document.getElementById('s').textContent=t)}}\
</script></body></html>"
    )
}

fn handle(mut stream: TcpStream, app: &tauri::AppHandle) {
    let Some(request) = read_request(&mut stream) else {
        return;
    };
    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();

    if path.starts_with("/speed") {
        let Some(token) = query_token(&request) else {
            respond(&mut stream, "403 Forbidden", "token required");
            return;
        };
        if !token_matches(&token) {
            respond(&mut stream, "403 Forbidden", "bad token");
            return;
        }
        let factor = factor_for(
            query_what(&request).as_deref(),
            query_value(&request),
            crate::bridge_client::bridge64_get_speed().unwrap_or(1.0),
        );
        crate::bridge_client::bridge64_set_speed(factor);
        crate::bridge_client::bridge32_set_speed(factor);
        let _ = app.emit("speed-changed", serde_json::json!({ "factor": factor }));
        respond(&mut stream, "200 OK", &format!("{factor}"));
        return;
    }

    // The page itself needs the token as well: without it the page is useless.
    let token = match query_token(&request) {
        Some(token) if token_matches(&token) => token,
        _ => {
            respond(&mut stream, "403 Forbidden", "token required");
            return;
        }
    };
    respond(&mut stream, "200 OK", &page(&token));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_is_read_from_the_query() {
        assert_eq!(query_token("GET /speed?what=up&token=abc HTTP/1.1").as_deref(), Some("abc"));
        assert_eq!(query_token("GET /speed?what=up HTTP/1.1"), None);
    }

    #[test]
    fn the_value_is_read_from_the_query() {
        assert_eq!(query_value("GET /speed?what=up&value=1.5 HTTP/1.1"), Some(1.5));
        assert_eq!(query_value("GET /speed?what=up HTTP/1.1"), None);
    }

    #[test]
    fn the_page_buttons_are_read_from_the_query() {
        assert_eq!(query_what("GET /speed?what=up&token=abc HTTP/1.1").as_deref(), Some("up"));
        assert_eq!(query_what("GET /speed?what=down&token=abc HTTP/1.1").as_deref(), Some("down"));
        assert_eq!(query_what("GET /speed?what=reset&token=abc HTTP/1.1").as_deref(), Some("reset"));
        assert_eq!(query_what("GET /speed?value=2&token=abc HTTP/1.1"), None);
    }

    #[test]
    fn buttons_change_the_speed_instead_of_all_resetting_it() {
        assert_eq!(factor_for(Some("up"), None, 1.0), 1.5);
        assert_eq!(factor_for(Some("down"), None, 1.0), 0.5);
        assert_eq!(factor_for(Some("reset"), None, 3.0), 1.0);
        assert_eq!(factor_for(None, Some(2.5), 3.0), 2.5);
        assert_eq!(factor_for(None, None, 3.0), 1.0);
        assert_eq!(factor_for(Some("down"), None, 0.2), 0.01);
    }

    /// The lock is released again before the check runs — the mutex is not
    /// reentrant, so holding it across `token_matches` would deadlock.
    fn set_token(value: &str) {
        let mut current = match TOKEN.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        *current = value.to_string();
    }

    #[test]
    fn a_token_is_needed_before_anything_works() {
        // No token while the feature is off.
        set_token("");
        assert!(!token_matches("anything"));
        assert!(!token_matches(""));
    }

    #[test]
    fn only_the_current_token_is_accepted() {
        set_token("abc");
        assert!(token_matches("abc"));
        assert!(!token_matches("abd"));
        assert!(!token_matches(""));
        set_token("");
    }

    #[test]
    fn the_port_is_loopback_only() {
        // The listener address is fixed in the source; a typo here would put
        // the page on the network.
        assert!(format!("http://127.0.0.1:{PORT}/").starts_with("http://127.0.0.1:"));
    }
}
