// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(windows, windows_subsystem = "windows")]


fn main() {
  println!("APP BOOT PID={}", std::process::id());
  app_lib::run();
}
