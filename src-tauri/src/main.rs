#![windows_subsystem = "console"]
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::process::Stdio;
use sysinfo::{System, SystemExt, ProcessExt, PidExt};
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use tracing_subscriber::Layer;
use tauri::{AppHandle, Emitter};
use once_cell::sync::Lazy;
use maxminddb::Reader;
use reqwest;
use tokio::fs;
use directories::BaseDirs;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GeoLocation {
    pub lat: f64,
    pub lng: f64,
    pub city: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
}

// Static reference to the geolocation database
static GEO_DB: Lazy<Option<Reader<Vec<u8>>>> = Lazy::new(|| {
    // Look for the geolocation database file in resources or app data
    let base_dirs = BaseDirs::new();
    let data_dir = base_dirs.as_ref().map(|dirs| dirs.data_dir()).unwrap_or(Path::new("."));
    let possible_paths = [
        "resources/GeoLite2-City.mmdb",
        "GeoLite2-City.mmdb",
        &format!("{}/Local/tracert/GeoLite2-City.mmdb", data_dir.to_str().unwrap()),
    ];
    
    for path in &possible_paths {
        if Path::new(path).exists() {
            match Reader::open_readfile(Path::new(path)) {
                Ok(reader) => return Some(reader),
                Err(e) => {
                    eprintln!("Failed to load geodb from {}: {}", path, e);
                }
            }
        }
    }
    None
});

#[derive(Serialize, Clone)]
struct TraceLineEvent {
  trace_id: String,
  line_no: u32,
  line: String,
}

#[derive(Serialize, Clone)]
struct TraceCompleteEvent {
  trace_id: String,
  result: TraceResult,
}

fn emit_trace_line(app: &AppHandle, trace_id: &str, line_no: u32, line: &str) {
  let payload = TraceLineEvent {
    trace_id: trace_id.to_string(),
    line_no,
    line: line.to_string(),
  };

  // emit to all windows (easy mode)
  let _ = app.emit("trace:line", payload);
}

fn emit_trace_complete(app: &AppHandle, trace_id: &str, result: &TraceResult) {
  tracing::info!("[Rust] [TRACE] emit_trace_complete called with trace_id: {}", trace_id);
  let payload = TraceCompleteEvent {
    trace_id: trace_id.to_string(),
    result: result.clone(),
  };

  // emit to all windows (easy mode)
  tracing::info!("[Rust] [TRACE] About to emit 'trace:complete' event for trace_id: {}", trace_id);
  let emit_result = app.emit("trace:complete", payload);
  tracing::info!("[Rust] [TRACE] Event emit result: {:?}", emit_result);
  match emit_result {
      Ok(_) => tracing::info!("[Rust] [TRACE] emit 'trace:complete' event -> Ok(())"),
      Err(e) => tracing::error!("[Rust] [TRACE] Failed to emit 'trace:complete' event: {}", e),
  }
}


// Global variables for single instance guard
static mut LOCK_FILE_PATH: Option<std::path::PathBuf> = None;
static SINGLE_INSTANCE_ACTIVE: AtomicBool = AtomicBool::new(false);

// Function to check if a process with given PID is running
fn is_process_running(pid: u32) -> bool {
    let mut system = System::new();
    system.refresh_processes();
    system.processes().values().any(|process| process.pid().as_u32() == pid)
}

// Function to create lock file and register cleanup
fn setup_single_instance_guard(app_data_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let lock_file_path = app_data_dir.join("tracert.lock");
    
    // Check if lock file exists
    if lock_file_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lock_file_path) {
            if let Ok(existing_pid) = content.trim().parse::<u32>() {
                if is_process_running(existing_pid) {
                    tracing::warn!("[Rust] [SINGLE_INSTANCE] Second instance detected, PID {} is still running. Exiting.", existing_pid);
                    eprintln!("[Rust] [SINGLE_INSTANCE] Another instance is already running (PID {}). Exiting.", existing_pid);
                    std::process::exit(1);
                } else {
                    tracing::info!("[Rust] [SINGLE_INSTANCE] Lock file exists but process {} is not running. Removing stale lock.", existing_pid);
                    let _ = std::fs::remove_file(&lock_file_path);
                }
            }
        }
    }
    
    // Create new lock file with current PID
    let current_pid = std::process::id();
    std::fs::write(&lock_file_path, current_pid.to_string())?;
    
    unsafe {
        LOCK_FILE_PATH = Some(lock_file_path.clone());
    }
    SINGLE_INSTANCE_ACTIVE.store(true, Ordering::SeqCst);
    
    tracing::info!("[Rust] [SINGLE_INSTANCE] Lock acquired for PID {}", current_pid);
    Ok(())
}

// Cleanup function to remove lock file
fn cleanup_lock_file() {
    if SINGLE_INSTANCE_ACTIVE.load(Ordering::SeqCst) {
        unsafe {
            if let Some(ref lock_path) = LOCK_FILE_PATH {
                if std::fs::remove_file(lock_path).is_ok() {
                    tracing::info!("[Rust] [SINGLE_INSTANCE] Lock file cleaned up for PID {}", std::process::id());
                }
            }
        }
        SINGLE_INSTANCE_ACTIVE.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
fn log_debug(message: String) {
    tracing::debug!("[React] {}", message);
}

#[tauri::command]
fn log_info(message: String) {
    tracing::info!("[React] {}", message);
}

#[tauri::command]
fn log_warn(message: String) {
    tracing::warn!("[React] {}", message);
}

#[tauri::command]
fn log_error(message: String) {
    tracing::error!("[React] {}", message);
}

#[derive(Serialize)]
struct GeoResult {
    ip: String,
    lat: Option<f64>,
    lng: Option<f64>,
    city: Option<String>,
    country: Option<String>,
    country_code: Option<String>,
}

#[tauri::command]
async fn geo_lookup(ip: String) -> Result<GeoResult, String> {
    // Check if it's a private IP - don't look up geolocation for private IPs
    if ip.starts_with("10.") || 
       ip.starts_with("192.168.") || 
       (ip.starts_with("172.") && {
           let parts: Vec<&str> = ip.split('.').collect();
           if parts.len() > 1 {
               let second_octet = parts[1].parse::<u8>().unwrap_or(0);
               (16..=31).contains(&second_octet)
           } else {
               false
           }
       }) {
        return Ok(GeoResult {
            ip,
            lat: None,
            lng: None,
            city: Some("Private/Internal".to_string()),
            country: None,
            country_code: None,
        });
    }

    let db = GEO_DB.as_ref().ok_or_else(|| "Geolocation database not loaded".to_string())?;
    let addr: std::net::IpAddr = ip.parse().map_err(|_| "Invalid IP address".to_string())?;

    match db.lookup::<maxminddb::geoip2::City>(addr) {
        Ok(city) => {
            let lat = city.location.as_ref().and_then(|l| l.latitude);
            let lng = city.location.as_ref().and_then(|l| l.longitude);

            let city_name = city.city
                .as_ref()
                .and_then(|c| c.names.as_ref())
                .and_then(|n| n.get("en"))
                .map(|s| s.to_string());

            let country_name = city.country
                .as_ref()
                .and_then(|c| c.names.as_ref())
                .and_then(|n| n.get("en"))
                .map(|s| s.to_string());

            let country_code = city.country
                .as_ref()
                .and_then(|c| c.iso_code.as_ref())
                .map(|s| s.to_string()); // Convert &str to String

            Ok(GeoResult {
                ip,
                lat,
                lng,
                city: city_name,
                country: country_name,
                country_code,
            })
        }
        Err(_) => Ok(GeoResult {
            ip,
            lat: None,
            lng: None,
            city: Some("Unknown".to_string()),
            country: Some("Unknown".to_string()),
            country_code: None,
        }),
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HopData {
    pub hop: u32,
    pub host: Option<String>,
    pub ip: Option<String>,
    #[serde(rename = "latencies")]
    pub latencies: Vec<Option<f64>>,
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

use tokio::sync::Notify;

struct RunningTrace {
    cancel_notify: Arc<Notify>,
    handle: tokio::task::JoinHandle<Result<TraceResult, String>>,
}

struct AppState {
    running_traces: Arc<Mutex<HashMap<String, RunningTrace>>>,
}

#[tauri::command]
async fn run_trace(
    app: tauri::AppHandle,
    target: String,
    options: TraceOptions,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let pid = std::process::id();
    tracing::info!("[Rust] [TRACE] run_trace start target='{}' pid={}", target, pid);

    // Validate target to prevent command injection
    if !is_valid_target(&target) {
        let error_msg = "Invalid target format".to_string();
        tracing::warn!("[Rust] [TRACE] {} for target: {}", error_msg, target);
        return Err(error_msg);
    }

    // Prepare command based on OS
    let (cmd, args) = prepare_trace_command(&target, &options)?;
    tracing::debug!("[Rust] [TRACE] Prepared command: '{}' with args: {:?}", cmd, args);

    // Create a unique ID for this trace
    let trace_id = uuid::Uuid::new_v4().to_string();
    tracing::debug!("[Rust] [TRACE] Generated trace_id: {}", trace_id);
    let trace_id_for_cleanup = trace_id.clone(); // Clone for the cleanup task
    
    let cancel_notify = Arc::new(Notify::new());
    let cancel_for_task = cancel_notify.clone();
    let cancel_for_exec = cancel_notify.clone();
    let app_for_task = app.clone();
    let trace_id_for_task = trace_id.clone();
    let state_for_cleanup = state.inner().running_traces.clone(); // Clone the Arc<Mutex<>> for cleanup
    
    // Execute the traceroute command in a cancellable task
    let trace_future = execute_trace_with_cancel(app_for_task, cmd, args, cancel_for_exec, trace_id_for_task.clone());
    tracing::debug!("[Rust] [TRACE] About to spawn async task");
    let handle = tokio::spawn(async move {
        tracing::debug!("[Rust] [TRACE] Inside spawned task for trace_id: {}", trace_id_for_task);
        let result = tokio::select! {
            result = trace_future => result,
            _ = cancel_for_task.notified() => Err("Trace cancelled by user".to_string()),
        };
        
        tracing::debug!("[Rust] [TRACE] Spawned task completed for trace_id: {}, result success: {}", trace_id_for_cleanup, result.is_ok());
        // Clean up the completed trace from the map after completion
        {
            let mut running_traces = state_for_cleanup.lock().await;
            running_traces.remove(&trace_id_for_cleanup);
        }
        
        result
    });
    tracing::debug!("[Rust] [TRACE] Spawned async task handle created");
    
    // Store the running trace
    {
        let mut running_traces = state.running_traces.lock().await;
        running_traces.insert(
            trace_id.clone(), 
            RunningTrace { cancel_notify, handle }
        );
        tracing::debug!("[Rust] [TRACE] Stored running trace with ID: {}", trace_id);
    }
    
    tracing::debug!("[Rust] [TRACE] About to return trace ID: {}", trace_id);
    tracing::debug!("[Rust] [TRACE] Trace ID length: {}", trace_id.len());
    // Return the trace ID immediately so UI can start listening
    let result = Ok(trace_id);
    tracing::debug!("[Rust] [TRACE] Returned trace ID result");
    result
}

async fn execute_trace_with_cancel(
    app: tauri::AppHandle,
    cmd: String, 
    args: Vec<String>, 
    cancel_notify: Arc<Notify>,
    trace_id: String
) -> Result<TraceResult, String> {
    let pid = std::process::id();
    tracing::info!("[Rust] [TRACE] execute_trace_with_cancel start cmd='{}' args='{:?}' pid={}", cmd, args, pid);
    
    // Create the command
    let mut child = Command::new(&cmd)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            let error_msg = format!("Failed to start {}: {}", cmd, e);
            tracing::error!("[Rust] [TRACE] Failed to spawn command: {}", error_msg);
            error_msg
        })?;
    
    let child_pid = child.id().unwrap_or(0);
    tracing::info!("[Rust] [TRACE] Child process spawned successfully pid={} cmd='{}'", child_pid, cmd);

    // Create readers for both stdout and stderr
    let stdout = child.stdout.take().ok_or_else(|| "Failed to get stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Failed to get stderr".to_string())?;

    let mut out_reader = BufReader::new(stdout).lines();
    let mut err_reader = BufReader::new(stderr).lines();
    
    let mut raw_output = String::new();
    let mut hops = Vec::new();
    let start_time = chrono::Utc::now().to_rfc3339();
    
    // Counters for diagnostic purposes
    let mut stdout_lines_read = 0;
    let mut stderr_lines_read = 0;
    let max_diag_lines = 10; // Only log first N lines to avoid spam
    
    // Continue reading from both stdout and stderr until both are closed
    let mut stdout_closed = false;
    let mut stderr_closed = false;
    
    tracing::info!("[Rust] [TRACE] Starting to read stdout and stderr streams");
    
    while !stdout_closed || !stderr_closed {
        tokio::select! {
            line = out_reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        stdout_lines_read += 1;
                        if stdout_lines_read <= max_diag_lines {
                            tracing::info!("[Rust] [TRACE] stdout line {}: {}", stdout_lines_read, line);
                        }
                        // Emit event for UI update
                        emit_trace_line(&app, &trace_id, stdout_lines_read, &line);
                        
                        raw_output.push_str(&line);
                        raw_output.push('\n');
                        
                        // Try to parse the line for hop data
                        if let Some(mut hop_data) = parse_traceroute_line(&line) {
                            tracing::debug!("[Rust] [TRACE] Parsed hop data: hop={}, ip={:?}, latencies={:?}", 
                                          hop_data.hop, hop_data.ip, hop_data.latencies);
                            
                            // Enrich this single hop with geolocation data immediately
                            if let Some(ref ip) = hop_data.ip {
                                if let Ok(geo_result) = geo_lookup_inner(ip.to_string()).await {
                                    // Convert GeoResult to GeoLocation
                                    hop_data.geo = Some(GeoLocation {
                                        lat: geo_result.lat.unwrap_or(0.0),
                                        lng: geo_result.lng.unwrap_or(0.0),
                                        city: geo_result.city,
                                        country: geo_result.country,
                                        country_code: geo_result.country_code,
                                    });
                                }
                            }
                            
                            hops.push(hop_data.clone()); // Store the enriched hop
                            
                            // Emit the enriched hop immediately - now with complete data
                            if let Err(e) = emit_hop_update(app.clone(), &trace_id, hop_data).await {
                                tracing::warn!("[Rust] [TRACE] Failed to emit hop update: {}", e);
                            }
                        } else {
                            tracing::debug!("[Rust] [TRACE] Line did not parse as hop: {}", line);
                        }
                    }
                    Ok(None) => {
                        tracing::info!("[Rust] [TRACE] stdout closed after reading {} lines", stdout_lines_read);
                        stdout_closed = true;
                    }
                    Err(e) => {
                        let error_msg = format!("stdout read error: {}", e);
                        tracing::error!("[Rust] [TRACE] {}", error_msg);
                        return Err(error_msg);
                    }
                }
            }
            line = err_reader.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        stderr_lines_read += 1;
                        if stderr_lines_read <= max_diag_lines {
                            tracing::debug!("[Rust] [TRACE] stderr line {}: {}", stderr_lines_read, line);
                        }
                        raw_output.push_str(&line);
                        raw_output.push('\n');
                        
                        // On Windows, tracert writes to stderr, so we should also try to parse stderr lines
                        if let Some(mut hop_data) = parse_traceroute_line(&line) {
                            tracing::debug!("[Rust] [TRACE] Parsed hop data from stderr: hop={}, ip={:?}, latencies={:?}", 
                                          hop_data.hop, hop_data.ip, hop_data.latencies);
                            
                            // Enrich this single hop with geolocation data immediately
                            if let Some(ref ip) = hop_data.ip {
                                if let Ok(geo_result) = geo_lookup_inner(ip.to_string()).await {
                                    // Convert GeoResult to GeoLocation
                                    hop_data.geo = Some(GeoLocation {
                                        lat: geo_result.lat.unwrap_or(0.0),
                                        lng: geo_result.lng.unwrap_or(0.0),
                                        city: geo_result.city,
                                        country: geo_result.country,
                                        country_code: geo_result.country_code,
                                    });
                                }
                            }
                            
                            hops.push(hop_data.clone()); // Store the enriched hop
                            
                            // Emit the enriched hop immediately
                            if let Err(e) = emit_hop_update(app.clone(), &trace_id, hop_data).await {
                                tracing::warn!("[Rust] [TRACE] Failed to emit hop update: {}", e);
                            }
                        } else {
                            tracing::debug!("[Rust] [TRACE] stderr line did not parse as hop: {}", line);
                        }
                    }
                    Ok(None) => {
                        tracing::info!("[Rust] [TRACE] stderr closed after reading {} lines", stderr_lines_read);
                        stderr_closed = true;
                    }
                    Err(e) => {
                        let error_msg = format!("stderr read error: {}", e);
                        tracing::error!("[Rust] [TRACE] {}", error_msg);
                        return Err(error_msg);
                    }
                }
            }
            _ = cancel_notify.notified() => {
                tracing::info!("[Rust] [TRACE] Cancel notification received, killing process pid={}", child_pid);
                let _ = child.kill().await;
                tracing::debug!("[Rust] raw_output bytes: {}", raw_output.len());
                tracing::debug!("[Rust] raw_output preview: {}", raw_output.lines().take(5).collect::<Vec<_>>().join(" | "));
                return Err("[Rust] Trace cancelled by user".to_string());
            }
        }
    }
    
    tracing::info!("[Rust] [TRACE] Both stdout and stderr closed, about to wait for child process pid={}", child_pid);
    tracing::info!("[Rust] [TRACE] Hops collected so far: {}, Raw output length: {}", hops.len(), raw_output.len());
    
    // Wait for the process to finish with a timeout to prevent hanging
    let exit_status = tokio::time::timeout(
        tokio::time::Duration::from_secs(60), // 60 second timeout
        child.wait()
    ).await
        .map_err(|e| {
            let error_msg = format!("Process timed out after 60 seconds, killing process pid={}: {}", child_pid, e);
            tracing::error!("[Rust] [TRACE] {}", error_msg);
            error_msg
        })?
        .map_err(|e| {
            let error_msg = format!("Failed to wait for process: {}", e);
            tracing::error!("[Rust] [TRACE] {}", error_msg);
            error_msg
        })?;
    
    tracing::info!("[Rust] [TRACE] Child process finished with exit code: {}", exit_status.code().unwrap_or(-1));
    
    if !exit_status.success() {
        let error_msg = format!("{} failed with status code {}: process exited", cmd, exit_status.code().unwrap_or(-1));
        tracing::warn!("[Rust] [TRACE] {}", error_msg);
        // Return as warning rather than error to allow partial results
    }
    
    let end_time = Some(chrono::Utc::now().to_rfc3339());
    
    tracing::info!("[Rust] [TRACE] Trace completed - raw_output len: {}, hops count: {}", raw_output.len(), hops.len());

    let result = TraceResult {
        target: args.last().unwrap_or(&"unknown".to_string()).clone(),
        resolved_ip: None,
        hops,
        raw_output,
        start_time,
        end_time,
    };
    
    tracing::info!("[Rust] [TRACE] About to emit completion event for trace_id: {}", trace_id);
    // Emit completion event to notify frontend
    emit_trace_complete(&app, &trace_id, &result);
    tracing::info!("[Rust] [TRACE] Completion event emitted for trace_id: {}", trace_id);
    
    Ok(result)
}

#[tauri::command]
async fn stop_trace(trace_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut running_traces = state.running_traces.lock().await;
    if let Some(running_trace) = running_traces.remove(&trace_id) {
        running_trace.cancel_notify.notify_one();
        
        // Abort the task to ensure it stops immediately
        running_trace.handle.abort();
        
        Ok(())
    } else {
        Err("Trace not found".to_string())
    }
}


fn is_valid_target(target: &str) -> bool {
    // Basic validation to prevent command injection
    // Allow alphanumeric, dots, hyphens, colons (for IPv6), and underscores
    // Also allow basic domain names
    
    // Check for potentially dangerous characters
    if target.contains(' ') || target.contains('&') || target.contains('|') || 
       target.contains(';') || target.contains('`') || target.contains('$') ||
       target.contains('(') || target.contains(')') || target.contains('<') ||
       target.contains('>') || target.contains('"') || target.contains('\'') {
        return false;
    }
    
    // Check for valid IP or domain format
    let is_ip = target.parse::<std::net::IpAddr>().is_ok();
    let is_domain = {
        // Basic domain validation: letters, digits, dots, hyphens
        // Must contain at least one dot and not start/end with special chars
        !target.is_empty() &&
        target.len() <= 255 &&
        target.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') &&
        target.starts_with(|c: char| c.is_ascii_alphanumeric()) &&
        target.ends_with(|c: char| c.is_ascii_alphanumeric()) &&
        target.chars().any(|c| c == '.') &&  // Must contain at least one dot
        !target.contains("..")  // No double dots
    };
    
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

fn parse_traceroute_line(line: &str) -> Option<HopData> {
    // Windows tracert format: " 1    <time> ms    <time> ms    <time> ms     <ip>"
    // Or: " 1    *        *        *     Request timed out."
    // Or: "10    81 ms    68 ms    62 ms  dns.google [8.8.8.8]" (domain [ip] format)
    // Unix traceroute format: " 1  <ip> (<ip>)  <time> ms  <time> ms  <time> ms"
    
    // Trim leading whitespace
    let line = line.trim();
    
    // Skip empty lines and header lines
    if line.is_empty() || 
       line.starts_with("Tracing") || 
       line.starts_with("over a maximum") || 
       line.starts_with("Trace complete") {
        return None;
    }
    
    // Try to extract hop number
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    
    // Extract hop number
    let hop_num = parts[0].parse::<u32>().ok()?;
    
    // Check if it's a timeout line - specifically look for "Request timed out"
    if line.contains("Request timed out") {
        return Some(HopData {
            hop: hop_num,
            host: None,
            ip: None,
            latencies: vec![None, None, None], // Three timeouts
            avg_latency: None,
            status: "timeout".to_string(),
            geo: None,
        });
    }
    
    // Parse based on OS format
    #[cfg(windows)]
    {
        // Windows format: "1    <1 ms    <1 ms    <1 ms    192.168.1.1"
        // Or: "1    1 ms    1 ms    1 ms    192.168.1.1"
        // Or: "1    *        *        *     Request timed out."
        // Or: "10    81 ms    68 ms    62 ms  dns.google [8.8.8.8]" (special domain [ip] format)
        
        let mut latencies = Vec::new();
        let mut ip_part = None;
        let mut host_part = None;
        
        let mut i = 1; // Start after hop number
        
        // Process up to 3 latency values - look for the pattern: number ms
        let mut latency_count = 0;
        while i < parts.len() && latency_count < 3 {
            let part = parts[i];
            
            if part.ends_with("ms") {
                // Handle cases like "<1 ms", "1 ms", "100 ms"
                let time_str = part.strip_suffix("ms").unwrap_or(part);
                let time_str = time_str.trim_start_matches('<'); // Handle "<1" case
                if let Ok(time) = time_str.trim().parse::<f64>() {
                    latencies.push(Some(time));
                } else {
                    latencies.push(None);
                }
                latency_count += 1;
            } else if part == "*" {
                latencies.push(None);
                latency_count += 1;
            }
            // If it's not a latency marker, continue to the next part
            i += 1;
        }
        
        // The remaining parts should contain IP/address
        // Look for the IP address at the end of the line
        for j in i..parts.len() {
            let part = parts[j];
            
            // Check for the special "domain [ip]" format (e.g., "dns.google [8.8.8.8]")
            if part.starts_with('[') && part.ends_with(']') {
                // Extract IP from [ip] format
                let inner = &part[1..part.len()-1]; // Remove [ and ]
                if is_valid_ipv4_format(inner) {
                    ip_part = Some(inner.to_string());
                    // If previous part looks like a hostname, capture it
                    if j > 0 && !parts[j-1].ends_with("ms") && parts[j-1] != "*" {
                        host_part = Some(parts[j-1].to_string());
                    }
                    break;
                }
            }
            // If it looks like an IP (contains dots and valid format)
            else if part.contains('.') && is_valid_ipv4_format(part) {
                ip_part = Some(part.to_string());
                break;
            }
        }
        
        // Calculate average latency if we have valid samples
        let valid_latencies: Vec<f64> = latencies.iter()
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
            latencies: vec![], // Empty array since we only show average
            avg_latency,
            status: if !valid_latencies.is_empty() { "success".to_string() } else { "timeout".to_string() },
            geo: None,
        })
    }
    
    #[cfg(unix)]
    {
        // Unix format: "1  192.168.1.1 (192.168.1.1)  1.234 ms  2.345 ms  2.346 ms"
        let mut latencies = Vec::new();
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
                        let clean_ip = next_part.strip_prefix('(')?.strip_suffix(')')?;
                        ip_part = Some(clean_ip.to_string());
                    } else {
                        // Just IP
                        ip_part = Some((*ip_or_host).to_string());
                        // Check if next part is in parentheses (hostname)
                        if next_part.starts_with('(') && next_part.ends_with(')') {
                            let clean_host = next_part.strip_prefix('(')?.strip_suffix(')')?;
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
                latencies.push(Some(time));
            } else if *part == "*" {
                latencies.push(None);
            }
        }
        
        // Calculate average latency if we have valid samples
        let valid_latencies: Vec<f64> = latencies.iter()
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
            latencies: vec![], // Empty array since we only show average
            avg_latency,
            status: if !valid_latencies.is_empty() { "success".to_string() } else { "timeout".to_string() },
            geo: None,
        })
    }
}

// Helper function to validate IPv4 format
fn is_valid_ipv4_format(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    
    for part in parts {
        if let Ok(num) = part.parse::<u8>() {
            if num > 255 {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

fn setup_logging() -> Result<(), Box<dyn std::error::Error>> {
    use tracing_subscriber::{
        fmt,
        layer::SubscriberExt,
        util::SubscriberInitExt,
        EnvFilter,
    };
    use tracing_appender::rolling;
    
    // Get app data directory
    let app_data_dir = directories::BaseDirs::new()
        .map(|dirs| dirs.data_dir().join("TraceRT"))
        .or_else(|| {
            std::env::current_dir().ok().map(|dir| dir.join("data"))
        })
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    
    // Ensure log directory exists
    let log_dir = app_data_dir.join("logs");
    std::fs::create_dir_all(&log_dir)?;
    
    // Create daily rolling file appender
    let file_appender = rolling::daily(&log_dir, "tracert.log");
    
    let pid = std::process::id();
    // Use system time instead of local offset since there are API issues
    let file_layer = fmt::layer()
        .with_ansi(false)
        .with_writer(file_appender)
        .with_filter(EnvFilter::from_default_env().add_directive("trace_rt=debug".parse()?));
        
    let console_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_filter(EnvFilter::from_default_env().add_directive("trace_rt=debug".parse()?));
    
    tracing_subscriber::registry()
        .with(file_layer)
        .with(console_layer)
        .try_init()
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
        
    tracing::info!("[Rust] [LIFECYCLE] App starting, PID={}", pid);
    tracing::info!("[Rust] [LIFECYCLE] Log file located at: {:?}", log_dir.join("tracert.log"));
    
    Ok(())
}

fn setup_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        let pid = std::process::id();
        let backtrace = std::backtrace::Backtrace::capture();
        
        tracing::error!(
            "[Rust] [LIFECYCLE] Application panicked PID={}\npanic info: {}\nbacktrace: {:?}",
            pid,
            panic_info,
            backtrace
        );
        
        eprintln!(
            "[Rust] [LIFECYCLE] Application panicked PID={}\npanic info: {}\nbacktrace: {:?}",
            pid,
            panic_info,
            backtrace
        );
    }));
}

fn setup_ctrlc_handler() {
    ctrlc::set_handler(move || {
        let pid = std::process::id();
        tracing::info!("[Rust] [LIFECYCLE] Received Ctrl+C signal, PID={}", pid);
        cleanup_lock_file();
        std::process::exit(0);
    }).expect("Error setting Ctrl+C handler");
}

fn main() {
    // Setup logging first
    if let Err(e) = setup_logging() {
        eprintln!("Failed to setup logging: {}", e);
        std::process::exit(1);
    }
    
    // Setup panic hook
    setup_panic_hook();
    
    // Setup Ctrl+C handler
    setup_ctrlc_handler();
    
    // Get app data directory and setup single instance guard
    let app_data_dir = directories::BaseDirs::new()
        .map(|dirs| dirs.data_dir().join("TraceRT"))
        .or_else(|| {
            std::env::current_dir().ok().map(|dir| dir.join("data"))
        })
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    
    std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
    
    if let Err(e) = setup_single_instance_guard(&app_data_dir) {
        tracing::error!("[Rust] Failed to setup single instance guard: {}", e);
        std::process::exit(1);
    }
    
    let pid = std::process::id();
    tracing::info!("[Rust] [LIFECYCLE] Setup complete, PID={}", pid);
    
    tauri::Builder::default()
        .manage(AppState {
            running_traces: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            run_trace,
            stop_trace,
            log_debug,
            log_info,
            log_warn,
            log_error,
            geo_lookup,
            download_geolite_db,
        ])
        .setup(|_app| {
            tracing::info!("[Rust] [LIFECYCLE] App setup completed, PID={}", std::process::id());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Failed to build tauri app")
        .run(|_app_handle, event| {
            match event {
                tauri::RunEvent::ExitRequested { .. } => {
                    tracing::info!("[Rust] [LIFECYCLE] Exit requested, PID={}", std::process::id());
                }
                tauri::RunEvent::Ready => {
                    tracing::info!("[Rust] [LIFECYCLE] App ready, PID={}", std::process::id());
                }
                tauri::RunEvent::WindowEvent { label: _, event: _, .. } => {}
                _ => {}
            }
        });
        
    tracing::info!("[Rust] [LIFECYCLE] App shutting down, PID={}", pid);
}

// Function to enrich hop data with geolocation information
async fn enrich_hops_with_geolocation(hops: Vec<HopData>) -> Vec<HopData> {
    // Since geolocation is now handled in real-time as each hop is parsed,
    // this function is no longer needed for geolocation enrichment.
    // It's kept for backward compatibility but returns hops as-is.
    tracing::debug!("[Rust] [GEO] Skipping bulk geolocation enrichment - handled in real-time per hop");
    hops
}

// Helper function to check if an IP is private
fn is_private_ip(ip_str: &str) -> bool {
    tracing::debug!("[Rust] [GEO] Checking if IP {} is private", ip_str);
    
    let is_private = ip_str.starts_with("10.") || 
    ip_str.starts_with("192.168.") || 
    (ip_str.starts_with("172.") && {
        let parts: Vec<&str> = ip_str.split('.').collect();
        if parts.len() > 1 {
            if let Ok(second_octet) = parts[1].parse::<u8>() {
                let is_private_range = (16..=31).contains(&second_octet);
                tracing::debug!("[Rust] [GEO] 172.x.x.x second octet: {}, private range: {}", second_octet, is_private_range);
                is_private_range
            } else {
                tracing::debug!("[Rust] [GEO] Failed to parse second octet for 172.x.x.x IP");
                false
            }
        } else {
            false
        }
    });
    
    tracing::debug!("[Rust] [GEO] IP {} is private: {}", ip_str, is_private);
    is_private
}

// Internal function to perform geolocation lookup
async fn geo_lookup_inner(ip: String) -> Result<GeoResult, String> {
    tracing::debug!("[Rust] [GEO] Starting geolocation lookup for IP: {}", ip);
    
    // Check if it's a private IP - don't look up geolocation for private IPs
    if ip.starts_with("10.") || 
       ip.starts_with("192.168.") || 
       (ip.starts_with("172.") && {
           let parts: Vec<&str> = ip.split('.').collect();
           if parts.len() > 1 {
               let second_octet = parts[1].parse::<u8>().unwrap_or(0);
               (16..=31).contains(&second_octet)
           } else {
               false
           }
       }) {
        tracing::debug!("[Rust] [GEO] Skipping geolocation for private IP: {}", ip);
        return Ok(GeoResult {
            ip,
            lat: None,
            lng: None,
            city: Some("Private/Internal".to_string()),
            country: None,
            country_code: None,
        });
    }

    let db = GEO_DB.as_ref().ok_or_else(|| {
        tracing::warn!("[Rust] [GEO] Geolocation database not loaded");
        "Geolocation database not loaded".to_string()
    })?;
    
    let addr: std::net::IpAddr = ip.parse().map_err(|e| {
        tracing::warn!("[Rust] [GEO] Invalid IP address {}: {}", ip, e);
        "Invalid IP address".to_string()
    })?;

    match db.lookup::<maxminddb::geoip2::City>(addr) {
        Ok(city) => {
            let lat = city.location.as_ref().and_then(|l| l.latitude);
            let lng = city.location.as_ref().and_then(|l| l.longitude);

            let city_name = city.city
                .as_ref()
                .and_then(|c| c.names.as_ref())
                .and_then(|n| n.get("en"))
                .map(|s| s.to_string());

            let country_name = city.country
                .as_ref()
                .and_then(|c| c.names.as_ref())
                .and_then(|n| n.get("en"))
                .map(|s| s.to_string());

            let country_code = city.country
                .as_ref()
                .and_then(|c| c.iso_code.as_ref())
                .map(|s| s.to_string());

            tracing::debug!("[Rust] [GEO] Successful lookup for {}: lat={:?}, lng={:?}, city={:?}, country={:?}",
                           ip, lat, lng, city_name, country_name);
            
            Ok(GeoResult {
                ip,
                lat,
                lng,
                city: city_name,
                country: country_name,
                country_code,
            })
        }
        Err(e) => {
            tracing::debug!("[Rust] [GEO] Geolocation lookup failed for {}: {}", ip, e);
            Ok(GeoResult {
                ip,
                lat: None,
                lng: None,
                city: Some("Unknown".to_string()),
                country: Some("Unknown".to_string()),
                country_code: None,
            })
        },
    }
}

#[tauri::command]
async fn download_geolite_db() -> Result<String, String> {
    let app_data_dir = BaseDirs::new()
        .map(|dirs| dirs.data_dir().join("Local").join("tracert"))
        .unwrap_or(Path::new("./Local/tracert").to_path_buf());
    
    // Create directory if it doesn't exist
    fs::create_dir_all(&app_data_dir).await
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    
    let db_path = app_data_dir.join("GeoLite2-City.mmdb");
    
    // Check if file already exists
    if db_path.exists() {
        return Ok("Database already exists".to_string());
    }
    
    let url = "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb";
    
    // Download the file
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to download database: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    
    let content = response.bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    // Write to file
    fs::write(&db_path, content).await
        .map_err(|e| format!("Failed to save database: {}", e))?;
    
    Ok(format!("Database downloaded to: {}", db_path.display()))
}

// Add a new event for individual hop updates
#[tauri::command]
async fn emit_hop_update(
    app: tauri::AppHandle,
    trace_id: &str,
    hop_data: HopData
) -> Result<(), String> {
    tracing::debug!("[Rust] [TRACE] emit_hop_update called with trace_id: {}, hop: {}", trace_id, hop_data.hop);
    
    let event_payload = serde_json::json!({
        "trace_id": trace_id,
        "hop_data": hop_data
    });
    
    let result = app.emit("hop:update", &event_payload)
        .map_err(|e| format!("Failed to emit hop:update event: {}", e));
    
    tracing::debug!("[Rust] [TRACE] emit 'hop:update' event -> {:?}", result);
    result
}
