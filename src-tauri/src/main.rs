#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Child;
use tokio::sync::Mutex;
use tracing::{info, error};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GeoLocation {
    pub lat: f64,
    pub lng: f64,
    pub city: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HopData {
    pub hop: u32,
    pub host: Option<String>,
    pub ip: Option<String>,
    #[serde(rename = "latencies")]
    pub latency_samples: Vec<Option<f64>>,
    #[serde(rename = "avgLatency")]
    pub avg_latency: Option<f64>,
    pub status: String, // "success", "timeout", "pending"
    pub geo: Option<GeoLocation>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TraceResult {
    pub target: String,
    #[serde(rename = "resolvedIp")]
    pub resolved_ip: Option<String>,
    pub hops: Vec<HopData>,
    #[serde(rename = "rawOutput")]
    pub raw_output: String,
    #[serde(rename = "startTime")]
    pub start_time: String,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TraceOptions {
    #[serde(rename = "maxHops")]
    pub max_hops: Option<u32>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
    #[serde(rename = "probesPerHop")]
    pub probes_per_hop: Option<u32>,
    #[serde(rename = "resolveDns")]
    pub resolve_dns: Option<bool>,
}

struct AppState {
    running_processes: Arc<Mutex<HashMap<String, Child>>>,
}

#[tauri::command]
async fn run_trace(
    target: String,
    options: TraceOptions,
    state: tauri::State<'_, AppState>,
) -> Result<TraceResult, String> {
    info!("Starting trace to target: {}", target);

    // Validate target to prevent command injection
    if !is_valid_target(&target) {
        return Err("Invalid target format".to_string());
    }

    // Prepare command based on OS
    let (cmd, args) = prepare_trace_command(&target, &options)?;

    // Spawn the traceroute process
    let mut child = tokio::process::Command::new(&cmd)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start traceroute: {}", e))?;

    // Store process in state for potential cancellation
    let trace_id = uuid::Uuid::new_v4().to_string();
    {
        let mut processes = state.running_processes.lock().await;
        processes.insert(trace_id.clone(), child);
    }

    // Read output line by line
    let output = {
        let processes = state.running_processes.lock().await;
        let child_ref = processes.get(&trace_id).unwrap();
        
        // We need to read from the stdout of the child process
        // For simplicity in this implementation, we'll wait for completion
        drop(processes);
        
        // Wait for the process to complete and get output
        let output_result = child.wait_with_output().await
            .map_err(|e| format!("Failed to read traceroute output: {}", e))?;
        
        // Remove from running processes after completion
        {
            let mut processes = state.running_processes.lock().await;
            processes.remove(&trace_id);
        }
        
        String::from_utf8(output_result.stdout)
            .map_err(|_| "Invalid UTF-8 in traceroute output".to_string())?
    };

    // Parse the output
    let hops = parse_traceroute_output(&output, &target)?;
    
    let raw_output = output;
    let start_time = chrono::Utc::now().to_rfc3339();
    let end_time = Some(chrono::Utc::now().to_rfc3339());

    Ok(TraceResult {
        target,
        resolved_ip: None, // Will be resolved by the traceroute command
        hops,
        raw_output,
        start_time,
        end_time,
    })
}

#[tauri::command]
async fn stop_trace(trace_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut processes = state.running_processes.lock().await;
    if let Some(mut child) = processes.remove(&trace_id) {
        child.kill()
            .await
            .map_err(|e| format!("Failed to kill process: {}", e))?;
        info!("Successfully stopped trace with ID: {}", trace_id);
        Ok(())
    } else {
        Err("Process not found".to_string())
    }
}

fn is_valid_target(target: &str) -> bool {
    // Basic validation to prevent command injection
    // Allow alphanumeric, dots, hyphens, colons (for IPv6), and underscores
    // Also allow basic domain names
    let re = regex::Regex::new(r"^[a-zA-Z0-9.-_:]+$").unwrap();
    if !re.is_match(target) {
        return false;
    }
    
    // Check for potentially dangerous characters
    if target.contains(' ') || target.contains('&') || target.contains('|') || 
       target.contains(';') || target.contains('`') || target.contains('$') {
        return false;
    }
    
    // Additional validation: ensure it looks like a valid IP or domain
    let is_ip = target.parse::<std::net::IpAddr>().is_ok();
    let is_domain = target.chars().any(|c| c == '.') && target.len() >= 3;
    
    is_ip || is_domain
}

fn prepare_trace_command(target: &str, options: &TraceOptions) -> Result<(String, Vec<String>), String> {
    let cmd;
    let mut args = Vec::new();

    // Set command based on OS
    #[cfg(windows)]
    {
        cmd = "tracert".to_string();
        args.push("-d".to_string()); // Don't resolve addresses to names initially
        
        if let Some(max_hops) = options.max_hops {
            args.push("-h".to_string());
            args.push(max_hops.to_string());
        }
        
        if let Some(timeout_ms) = options.timeout_ms {
            args.push("-w".to_string());
            args.push(timeout_ms.to_string());
        }
        
        if options.resolve_dns.unwrap_or(false) {
            // Remove -d flag if DNS resolution is requested
            if let Some(pos) = args.iter().position(|x| x == "-d") {
                args.remove(pos);
            }
        }
    }
    
    #[cfg(unix)]
    {
        cmd = "traceroute".to_string();
        
        if let Some(max_hops) = options.max_hops {
            args.push("-m".to_string());
            args.push(max_hops.to_string());
        }
        
        if let Some(timeout_ms) = options.timeout_ms {
            // Convert ms to seconds for traceroute
            let timeout_sec = std::cmp::max((timeout_ms as f64 / 1000.0).ceil() as u64, 1);
            args.push("-w".to_string());
            args.push(timeout_sec.to_string());
        }
        
        if let Some(probes) = options.probes_per_hop {
            args.push("-q".to_string());
            args.push(probes.to_string());
        }
        
        if !options.resolve_dns.unwrap_or(true) {
            args.push("-n".to_string()); // Skip reverse DNS lookup
        }
    }

    args.push(target.to_string());

    Ok((cmd, args))
}

fn parse_traceroute_output(output: &str, _target: &str) -> Result<Vec<HopData>, String> {
    let mut hops = Vec::new();
    
    for line in output.lines() {
        if let Some(hop_data) = parse_traceroute_line(line) {
            hops.push(hop_data);
        }
    }
    
    Ok(hops)
}

fn parse_traceroute_line(line: &str) -> Option<HopData> {
    // Windows tracert format: " 1    <time> ms    <time> ms    <time> ms     <ip>"
    // Or: " 1    *        *        *     Request timed out."
    // Unix traceroute format: " 1  <ip> (<ip>)  <time> ms  <time> ms  <time> ms"
    
    // Trim leading whitespace
    let line = line.trim();
    
    // Skip empty lines
    if line.is_empty() {
        return None;
    }
    
    // Try to extract hop number
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    
    // Extract hop number
    let hop_num = parts[0].parse::<u32>().ok()?;
    
    // Check if it's a timeout line
    if line.contains("Request timed out") || line.contains("*") {
        return Some(HopData {
            hop: hop_num,
            host: None,
            ip: None,
            latency_samples: vec![None, None, None], // Three timeouts
            avg_latency: None,
            status: "timeout".to_string(),
            geo: None,
        });
    }
    
    // Parse based on OS format
    #[cfg(windows)]
    {
        // Windows format: "1    1.234 ms    2.345 ms    3.456 ms    192.168.1.1"
        let mut latency_samples = Vec::new();
        let mut ip_part = None;
        let mut host_part = None;
        
        let mut iter = parts.iter().skip(1); // Skip hop number
        
        // Look for latency values
        while let Some(part) = iter.next() {
            if part.ends_with("ms") {
                let time_str = part.strip_suffix("ms")?;
                let time = time_str.parse::<f64>().ok()?;
                latency_samples.push(Some(time));
            } else if *part == "*" {
                latency_samples.push(None);
            } else if !part.contains("ms") && part != &"ms" {
                // This might be an IP or host
                if part.starts_with("Request") || part.starts_with("Tracing") {
                    continue;
                }
                
                // If it looks like an IP or hostname
                if part.contains('.') || part.contains(':') || part.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.') {
                    if ip_part.is_none() {
                        ip_part = Some((*part).to_string());
                    } else if host_part.is_none() {
                        host_part = Some((*part).to_string());
                    }
                }
            }
        }
        
        // Calculate average latency if we have valid samples
        let valid_latencies: Vec<f64> = latency_samples.iter()
            .filter_map(|opt| *opt)
            .collect();
        
        let avg_latency = if !valid_latencies.is_empty() {
            Some(valid_latencies.iter().sum::<f64>() / valid_latencies.len() as f64)
        } else {
            None
        };
        
        Some(HopData {
            hop: hop_num,
            host: host_part,
            ip: ip_part,
            latency_samples,
            avg_latency,
            status: if !valid_latencies.is_empty() { "success".to_string() } else { "timeout".to_string() },
            geo: None,
        })
    }
    
    #[cfg(unix)]
    {
        // Unix format: "1  192.168.1.1 (192.168.1.1)  1.234 ms  2.345 ms  3.456 ms"
        let mut latency_samples = Vec::new();
        let mut ip_part = None;
        let mut host_part = None;
        
        let mut iter = parts.iter().skip(1); // Skip hop number
        
        // First parts might be IP and/or hostname in parentheses
        if let Some(ip_or_host) = iter.next() {
            if !ip_or_host.contains("ms") && !ip_or_host.starts_with('(') {
                // This is likely the IP or host
                if let Some(next_part) = iter.next() {
                    if next_part.starts_with('(') && next_part.ends_with(')') {
                        // Format is host (ip) or ip (ip)
                        host_part = Some((*ip_or_host).to_string());
                        let clean_ip = next_part.strip_prefix('(')?.strip_suffix(')?;
                        ip_part = Some(clean_ip.to_string());
                    } else {
                        // Just IP
                        ip_part = Some((*ip_or_host).to_string());
                        // Check if next part is in parentheses (hostname)
                        if next_part.starts_with('(') && next_part.ends_with(')') {
                            let clean_host = next_part.strip_prefix('(')?.strip_suffix(')?;
                            host_part = Some(clean_host.to_string());
                            iter.next(); // Skip the parenthesized part
                        }
                    }
                }
            }
        }
        
        // Look for latency values
        for part in iter {
            if part.ends_with("ms") {
                let time_str = part.strip_suffix("ms")?;
                let time = time_str.parse::<f64>().ok()?;
                latency_samples.push(Some(time));
            } else if *part == "*" {
                latency_samples.push(None);
            }
        }
        
        // Calculate average latency if we have valid samples
        let valid_latencies: Vec<f64> = latency_samples.iter()
            .filter_map(|opt| *opt)
            .collect();
        
        let avg_latency = if !valid_latencies.is_empty() {
            Some(valid_latencies.iter().sum::<f64>() / valid_latencies.len() as f64)
        } else {
            None
        };
        
        Some(HopData {
            hop: hop_num,
            host: host_part,
            ip: ip_part,
            latency_samples,
            avg_latency,
            status: if !valid_latencies.is_empty() { "success".to_string() } else { "timeout".to_string() },
            geo: None,
        })
    }
}

fn main() {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    tauri::Builder::default()
        .manage(AppState {
            running_processes: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![run_trace, stop_trace])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}