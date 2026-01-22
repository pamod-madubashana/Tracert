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
