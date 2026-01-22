# TraceRT - Advanced Traceroute Visualization Tool

## Project Overview

TraceRT is a cross-platform desktop application built with Tauri v2 and Rust that provides real-time visualization of network traceroute data. The application combines powerful backend networking tools with an intuitive React frontend to visualize network paths and latency measurements on interactive maps.

## Features

- **Real-time Traceroute Visualization**: Watch network packets travel across the globe in real-time
- **Interactive World Map**: Visualize hop locations and route paths on a dynamic world map
- **Network Topology View**: See the network path in a structured topology diagram
- **Detailed Hop Information**: View latency, IP addresses, and geographic locations for each hop
- **Cross-platform Support**: Built with Tauri for native performance on Windows, macOS, and Linux
- **Geolocation Integration**: Automatically resolves IP addresses to geographic locations
- **Performance Metrics**: Displays accurate latency measurements as integers for clarity

## Technologies Used

- **Backend**: Rust, Tauri v2, Tokio async runtime
- **Frontend**: React, TypeScript, Vite
- **Styling**: Tailwind CSS, shadcn/ui
- **Maps**: AmCharts 5 with geodata
- **Geolocation**: MaxMind GeoLite2 database
- **Build Tools**: Cargo, npm, TypeScript

## Key Technical Features

- **Streaming Architecture**: Real-time event-driven updates using Tauri events
- **Smart State Management**: Proper hop state preservation using Map-based storage
- **Accurate Parsing**: Robust Windows `tracert` and Unix `traceroute` output parsing
- **Geographic Filtering**: Intelligent filtering of private IPs and invalid coordinates
- **Performance Optimization**: Integer-based latency display for cleaner UI

## Architecture Highlights

- **Backend Processing**: Rust handles traceroute execution, output parsing, and geolocation lookup
- **Event System**: Real-time updates via Tauri events (`trace:line`, `hop:update`, `trace:complete`)
- **Frontend State**: React hooks manage streaming data and maintain consistent UI state
- **Map Logic**: Smart origin point detection (first public hop with valid geo coordinates)

## Getting Started

### Prerequisites

- Node.js and npm
- Rust and Cargo
- Git
- Internet connection to download the geolocation database

### Installation

```sh
# Clone the repository
git clone <REPO_URL>

# Navigate to the project directory
cd TraceRT

# Install JavaScript dependencies
npm install

# Install Rust dependencies (if needed)
cargo check

# Start the development server
npm run dev
```

### Database Setup

The application requires the MaxMind GeoLite2 City database (GeoLite2-City.mmdb) for IP geolocation services. This database file needs to be placed in the appropriate application data directory:

**Automatic Download:**
The application can automatically download the database file when needed. If you encounter geolocation issues, you can trigger a manual download by using the download functionality in the app.

**Manual Download:**
1. Download the `GeoLite2-City.mmdb` file from: https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb
2. Place it in the appropriate directory based on your operating system:
   - **Windows:** `%APPDATA%\TraceRT\GeoLite2-City.mmdb` (typically `C:\Users\<username>\AppData\Roaming\TraceRT\GeoLite2-City.mmdb`)
   - **macOS:** `~/Library/Application Support/TraceRT/GeoLite2-City.mmdb`
   - **Linux:** `~/.local/share/TraceRT/GeoLite2-City.mmdb` or `~/.config/TraceRT/GeoLite2-City.mmdb`

### Building

```sh
# Build the application
npm run tauri build
```

## How It Works

1. **Trace Initiation**: User enters a target IP or domain name
2. **Backend Execution**: Rust executes the appropriate traceroute command for the OS
3. **Real-time Parsing**: Output is parsed line-by-line as it's generated
4. **Geolocation Lookup**: IP addresses are resolved to geographic coordinates
5. **Event Streaming**: Hop data is streamed to the frontend via Tauri events
6. **Visualization**: Interactive maps and tables update in real-time
7. **Completion**: Final results are aggregated and displayed when tracing completes

## Unique Capabilities

- **Origin Point Detection**: Map automatically centers on the first public hop with valid geo coordinates
- **Private IP Handling**: Properly identifies and handles private IP ranges (10.x, 192.168.x, 172.16-31.x)
- **State Preservation**: Maintains accurate geo data even when streaming updates occur
- **Clean Latency Display**: Rounds latency values to integers for improved readability
- **Robust Parsing**: Handles various traceroute output formats including domain-before-IP notation

## Contributing

Contributions are welcome! Feel free to submit pull requests or report issues.

## License

MIT
