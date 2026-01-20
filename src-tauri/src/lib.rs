use std::process::Command;
use regex::Regex;
use std::thread;
use std::sync::mpsc;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
fn run_traceroute(target: String) -> Result<String, String> {
    if !is_valid_target(&target) {
        return Err("Invalid target: must contain only letters, digits, dots, dashes, colons, and underscores. Max 255 characters.".to_string());
    }

    let target_clone = target.clone();
    let (tx, rx) = mpsc::channel();

    let handle = thread::spawn(move || {
        let result = match std::env::consts::OS {
            "windows" => {
                let mut cmd = Command::new("tracert");
                cmd.args(["-d", &target_clone]);

                // ✅ This is what prevents the pop-up console window
                #[cfg(windows)]
                {
                    cmd.creation_flags(CREATE_NO_WINDOW);
                }

                cmd.output()
            }
            _ => {
                let cmd_result = Command::new("traceroute")
                    .arg(&target_clone)
                    .output();

                match cmd_result {
                    Ok(output) => Ok(output),
                    Err(_) => Command::new("tracepath").arg(&target_clone).output(),
                }
            }
        };

        let _ = tx.send(result);
    });

    let output = match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(result) => result.map_err(|e| format!("Failed to execute traceroute: {}", e))?,
        Err(_) => return Err("Traceroute command timed out after 30 seconds".to_string()),
    };

    let _ = handle.join();

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Traceroute failed: {}", stderr))
    }
}
