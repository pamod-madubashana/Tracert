#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use regex::Regex;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
async fn run_traceroute(target: String) -> Result<String, String> {
  if !is_valid_target(&target) {
    return Err("Invalid target: must contain only letters, digits, dots, dashes, colons, and underscores. Max 255 characters."
      .to_string());
  }

  // run blocking process work off the async runtime thread
  let out = tauri::async_runtime::spawn_blocking(move || {
    run_traceroute_blocking(&target)
  })
  .await
  .map_err(|e| format!("Traceroute task failed: {e}"))??;

  Ok(out)
}

fn run_traceroute_blocking(target: &str) -> Result<String, String> {
  #[cfg(windows)]
  {
    let mut cmd = Command::new("tracert");
    cmd.args(["-d", target]);

    // Hide console window for the child process
    cmd.creation_flags(CREATE_NO_WINDOW);

    // also avoid inheriting anything odd
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let output = cmd
      .output()
      .map_err(|e| format!("Failed to execute tracert: {e}"))?;

    if output.status.success() {
      Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
      Err(format!(
        "tracert failed: {}",
        String::from_utf8_lossy(&output.stderr)
      ))
    }
  }

  #[cfg(not(windows))]
  {
    // Unix: traceroute, fallback to tracepath
    let output = Command::new("traceroute")
      .arg(target)
      .output()
      .or_else(|_| Command::new("tracepath").arg(target).output())
      .map_err(|e| format!("Failed to execute traceroute/tracepath: {e}"))?;

    if output.status.success() {
      Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
      Err(format!(
        "Traceroute failed: {}",
        String::from_utf8_lossy(&output.stderr)
      ))
    }
  }
}

fn is_valid_target(target: &str) -> bool {
  if target.is_empty() || target.len() > 255 {
    return false;
  }
  // keep it simple and safe
  let valid_chars = Regex::new(r"^[a-zA-Z0-9.\-:_]+$").unwrap();
  valid_chars.is_match(target)
}

fn main() {
  tauri::Builder::default()
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build(),
    )
    .invoke_handler(tauri::generate_handler![run_traceroute])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
