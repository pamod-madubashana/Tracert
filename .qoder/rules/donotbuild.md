---
trigger: always_on
---
{
  "build": {
    "local": {
      "enabled": false,
      "reason": "Builds must be performed via GitHub Actions to ensure consistent environments and proper signing",
      "alternative": "Use GitHub Actions workflow for building the Tauri application"
    }
  },
  "run": {
    "local": {
      "enabled": false,
      "reason": "Application should be built and distributed through CI/CD pipeline",
      "alternative": "Download built artifacts from GitHub Actions releases"
    }
  },
  "commands": {
    "blocked": [
      "npm run tauri build",
      "npm run tauri dev",
      "cargo build",
      "cargo run"
    ],
    "allowed": [
      "npm install",
      "npm run dev",
      "npm run build",
      "npm run lint"
    ]
  }
}