use std::path::{Path, PathBuf};
use std::process::Command;

/// Repo root = the parent of the src-tauri crate directory. CARGO_MANIFEST_DIR
/// is baked at compile time and points at the checkout on the dev machine.
fn repo_root() -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "could not locate the repository root".to_string())
}

fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("failed to run git (is it on PATH?): {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(format!("{stdout}{stderr}").trim().to_string());
    }
    Ok(format!("{stdout}{stderr}").trim().to_string())
}

/// The currently checked-out commit: "shorthash · YYYY-MM-DD HH:MM · subject".
/// Read at runtime, so it reflects what git actually has right now — unlike the
/// build-time stamp, which freezes at dev-server start and never changes when
/// the code is pulled underneath a running Vite server.
#[tauri::command]
pub fn current_rev() -> Result<String, String> {
    let repo = repo_root()?;
    git(&repo, &["log", "-1", "--format=%h \u{00b7} %cd \u{00b7} %s", "--date=format:%Y-%m-%d %H:%M"])
}

/// Update the checkout to the latest remote code.
///
/// `force = false`: `git pull --ff-only` — safe, but refuses if the local
/// checkout has diverged or has local commits.
/// `force = true`: `git fetch` then `git reset --hard @{u}` — discards local
/// changes and matches the remote exactly. This is what unblocks the common
/// case where a stray local change or a diverged history made --ff-only fail
/// silently, leaving the app stuck on an old build.
///
/// Returns the git output plus the resulting HEAD, so the UI can show exactly
/// which commit is now checked out. In `tauri dev` Vite hot-reloads the pulled
/// web code; native/Rust changes still need a full `tauri dev` restart.
#[tauri::command]
pub fn dev_update(force: Option<bool>) -> Result<String, String> {
    let repo = repo_root()?;
    let op = if force.unwrap_or(false) {
        git(&repo, &["fetch", "--all", "--prune"])
            .and_then(|f| git(&repo, &["reset", "--hard", "@{u}"]).map(|r| format!("{f}\n{r}")))
            .map_err(|e| format!("force update failed:\n{e}"))?
    } else {
        git(&repo, &["pull", "--ff-only"]).map_err(|e| {
            format!("git pull failed (the checkout may have local changes or have diverged — try Force to latest):\n{e}")
        })?
    };
    let head = git(&repo, &["log", "-1", "--format=%h %s"]).unwrap_or_default();
    Ok(format!("{op}\nHEAD now at {head}").trim().to_string())
}
