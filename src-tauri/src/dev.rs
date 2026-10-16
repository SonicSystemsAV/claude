use std::path::PathBuf;
use std::process::Command;

/// Dev-only: run `git pull --ff-only` in the repo so the running `tauri dev`
/// instance picks up the latest web code via Vite's hot reload. Returns git's
/// output. In a release build it refuses (there's no checkout to pull), and the
/// UI only shows the button in the dev build anyway.
///
/// Note: this updates the web layer (TS/React), which Vite reloads live. Changes
/// to the Rust/native side still need a full rebuild (refresh.cmd / tauri dev
/// restart) to take effect.
#[tauri::command]
pub fn dev_update() -> Result<String, String> {
    if !cfg!(debug_assertions) {
        return Err("Update is only available in the dev build.".into());
    }
    // Repo root = the parent of the src-tauri crate directory. CARGO_MANIFEST_DIR
    // is baked at compile time and points at the checkout on the dev machine.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo = manifest
        .parent()
        .ok_or_else(|| "could not locate the repository root".to_string())?;

    let out = Command::new("git")
        .args(["pull", "--ff-only"])
        .current_dir(repo)
        .output()
        .map_err(|e| format!("failed to run git (is it on PATH?): {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(format!("git pull failed:\n{stdout}{stderr}").trim().to_string());
    }
    Ok(format!("{stdout}{stderr}").trim().to_string())
}
