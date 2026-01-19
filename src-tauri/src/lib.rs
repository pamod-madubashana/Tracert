use regex::Regex;
use tauri_plugin_shell::{self, ShellExt};
use tauri::{Runtime, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![run_traceroute])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
fn run_traceroute(target: String) -> Result<String, String> {
    // Validate target input
    if !is_valid_target(&target) {
        return Err("Invalid target: must contain only letters, digits, dots, dashes, colons, and underscores. Max 255 characters.".to_string());
    }

    // Execute OS-specific traceroute command using shell plugin
    // We'll use std::process::Command with a timeout mechanism
    use std::process::Command;
    
    let output = match std::env::consts::OS {
        "windows" => {
            // Windows: tracert -d <target>
            Command::new("tracert")
                .args(["-d", &target])
                .output()
                .map_err(|e| format!("Failed to execute tracert: {}", e))?
        }
        _ => {
            // Unix-like systems: try traceroute first, fallback to tracepath
            let cmd_result = Command::new("traceroute")
                .arg(&target)
                .output();
            
            match cmd_result {
                Ok(output) => output,
                Err(_) => {
                    // Fallback to tracepath
                    Command::new("tracepath")
                        .arg(&target)
                        .output()
                        .map_err(|e| format!("Failed to execute traceroute or tracepath: {}", e))?
                }
            }
        }
    };

    // Check exit status and return appropriate result
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Traceroute failed: {}", stderr))
    }
}

fn is_valid_target(target: &str) -> bool {
    // Check length
    if target.is_empty() || target.len() > 255 {
        return false;
    }

    // Allow only letters, digits, dots, dashes, colons (IPv6), and underscores
    // This covers domains, IPv4, IPv6 addresses
    let valid_chars = Regex::new(r"^[a-zA-Z0-9.\-:_]+$").unwrap();
    
    // Additional checks for common invalid patterns
    let has_invalid_chars = Regex::new(r"[^a-zA-Z0-9.\-:_]").unwrap();
    
    valid_chars.is_match(target) && !has_invalid_chars.is_match(target)
}