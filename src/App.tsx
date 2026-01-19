import { useState, useEffect, useRef } from 'react';

// Define invoke function that will be initialized properly
let invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;

// Initialize invoke function dynamically
const initializeInvoke = async () => {
  try {
    // Try to import Tauri
    const tauriModule = await import('@tauri-apps/api');
    // @ts-ignore - Using dynamic property access to avoid type errors
    invoke = tauriModule.invoke;
  } catch (e) {
    // Fallback for browser development - mock implementation
    console.warn('Tauri not available, using mock implementation');
    invoke = async (cmd: string, args?: Record<string, unknown>) => {
      // Mock traceroute response for development
      if (cmd === 'run_traceroute') {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate delay
        return `Tracing route to ${args?.target} [${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}]
1     1 ms    <1 ms    <1 ms  192.168.1.1
2     2 ms     1 ms     1 ms  10.0.0.1
3     3 ms     2 ms     2 ms  ${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}
4     4 ms     3 ms     3 ms  ${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}
5     5 ms     4 ms     4 ms  ${(args?.target as string) || 'target.com'}`;
      }
      throw new Error(`Unknown command: ${cmd}`);
    };
  }
};

// Initialize invoke function when the module loads
initializeInvoke();

interface Hop {
  number: number;
  host: string;
  times: string[];
  latency?: number;
}

function App() {
  const [target, setTarget] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [rawOutput, setRawOutput] = useState('');
  const [parsedHops, setParsedHops] = useState<Hop[]>([]);
  const [error, setError] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [currentHop, setCurrentHop] = useState<number | null>(null);
  const scanIntervalRef = useRef<number | null>(null);

  // Simulate scanning effect
  useEffect(() => {
    if (isScanning) {
      scanIntervalRef.current = setInterval(() => {
        setScanProgress(prev => {
          if (prev >= 100) {
            clearInterval(scanIntervalRef.current as number);
            return 100;
          }
          return prev + Math.random() * 15;
        });
      }, 100);
    } else {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
      setScanProgress(0);
    }

    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, [isScanning]);

  const runTraceroute = async () => {
    if (!target.trim()) {
      setError('TARGET_REQUIRED');
      return;
    }

    setIsLoading(true);
    setIsScanning(true);
    setError('');
    setRawOutput('');
    setParsedHops([]);
    setCurrentHop(null);

    try {
      // Simulate progressive hop discovery
      for (let i = 1; i <= 30; i++) {
        setCurrentHop(i);
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
      }

      const result = await invoke('run_traceroute', { target }) as string;
      setRawOutput(result);
      parseHopsWithAnimation(result);
    } catch (err) {
      setError(err as string);
      setRawOutput('');
      setParsedHops([]);
    } finally {
      setIsLoading(false);
      setIsScanning(false);
      setCurrentHop(null);
    }
  };

  const parseHopsWithAnimation = (output: string) => {
    const lines = output.split('\n');
    const hops: Hop[] = [];
    
    lines.forEach((line, index) => {
      setTimeout(() => {
        // Windows tracert format: 1    <1 ms    <1 ms    <1 ms  192.168.1.1
        const winMatch = line.match(/^(\d+)\s+(.+?)\s+(\d+|\*)\s+(ms|\*)/);
        
        // Unix traceroute format: 1  192.168.1.1  0.500 ms  0.400 ms  0.300 ms
        const unixMatch = line.match(/^(\d+)\s+([^\s]+)\s+(.+)$/);
        
        if (winMatch) {
          const [, hopNum, host] = winMatch;
          const times = line.match(/(\d+|\*)\s+ms/g)?.map(t => t.replace(/\s+ms/, '')) || [];
          const latency = times.find(t => t !== '*') ? parseFloat(times.find(t => t !== '*') || '0') : undefined;
          
          hops.push({
            number: parseInt(hopNum),
            host: host.trim(),
            times: times.map(t => t === '*' ? 'TIMEOUT' : `${t}ms`),
            latency
          });
        } else if (unixMatch) {
          const [, hopNum, host] = unixMatch;
          const times = line.match(/(\d+\.\d+|\*)\s+ms/g)?.map(t => t.replace(/\s+ms/, '')) || [];
          const latency = times.find(t => t !== '*') ? parseFloat(times.find(t => t !== '*') || '0') : undefined;
          
          hops.push({
            number: parseInt(hopNum),
            host: host.trim(),
            times: times.map(t => t === '*' ? 'TIMEOUT' : `${t}ms`),
            latency
          });
        }
        
        setParsedHops([...hops]);
      }, index * 80); // Staggered appearance
    });
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(rawOutput);
  };

  const exportToFile = () => {
    const blob = new Blob([rawOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `traceroute-${target}-${new Date().toISOString().slice(0, 19)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getLatencyColor = (latency?: number) => {
    if (!latency) return 'text-cyan-400';
    if (latency < 50) return 'text-green-400';
    if (latency < 150) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getLatencyGlow = (latency?: number) => {
    if (!latency) return 'shadow-cyan-400/50';
    if (latency < 50) return 'shadow-green-400/50';
    if (latency < 150) return 'shadow-yellow-400/50';
    return 'shadow-red-400/50';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black text-cyan-300 font-mono overflow-hidden">
      {/* Animated background grid */}
      <div className="fixed inset-0 opacity-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,255,255,0.1),transparent_70%)]"></div>
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}></div>
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-6xl">
        {/* Header with glitch effect */}
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-7xl font-bold mb-4 relative">
            <span className="relative inline-block">
              TRACE<span className="text-purple-400">RT</span>
              <span className="absolute inset-0 text-cyan-300 animate-pulse opacity-70" style={{
                clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)'
              }}>TRACE<span className="text-purple-400">RT</span></span>
            </span>
          </h1>
          <div className="h-1 w-32 bg-gradient-to-r from-cyan-400 to-purple-500 mx-auto rounded-full mb-4"></div>
          <p className="text-cyan-400/80 text-lg">NETWORK PATH ANALYSIS TERMINAL</p>
        </div>

        {/* Main control panel */}
        <div className="bg-gray-800/50 backdrop-blur-lg rounded-2xl border border-cyan-500/30 p-8 mb-8 shadow-2xl shadow-cyan-500/20">
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="flex-1 relative">
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="ENTER TARGET IP/DOMAIN"
                className="w-full px-6 py-4 bg-black/70 border-2 border-cyan-500/50 rounded-xl text-cyan-300 placeholder-cyan-500/50 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 transition-all duration-300 font-mono text-lg"
                disabled={isLoading}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && runTraceroute()}
              />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-cyan-500/20 to-purple-500/20 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
            </div>
            <button
              onClick={runTraceroute}
              disabled={isLoading || !target.trim()}
              className={`px-8 py-4 rounded-xl font-bold text-lg transition-all duration-300 relative overflow-hidden ${
                isLoading 
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white shadow-lg hover:shadow-cyan-500/50'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin"></div>
                  SCANNING...
                </div>
              ) : (
                'INITIATE TRACE'
              )}
              {!isLoading && (
                <div className="absolute inset-0 bg-white/20 opacity-0 hover:opacity-100 transition-opacity duration-300"></div>
              )}
            </button>
          </div>

          {/* Scanning progress bar */}
          {isScanning && (
            <div className="mb-6">
              <div className="flex justify-between text-sm text-cyan-400 mb-2">
                <span>SCANNING PROGRESS</span>
                <span>{Math.round(scanProgress)}%</span>
              </div>
              <div className="h-3 bg-black/50 rounded-full overflow-hidden border border-cyan-500/30">
                <div 
                  className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${scanProgress}%` }}
                ></div>
              </div>
              {currentHop && (
                <div className="text-center mt-2 text-cyan-400/80 text-sm">
                  ANALYZING HOP #{currentHop}...
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 font-mono">
              <div className="flex items-center gap-2">
                <span className="text-red-400">⚠</span>
                <span>ERROR: {error}</span>
              </div>
            </div>
          )}
        </div>

        {/* Results section */}
        {(rawOutput || parsedHops.length > 0) && (
          <div className="space-y-8">
            {/* Network topology visualization */}
            {parsedHops.length > 0 && (
              <div className="bg-gray-800/50 backdrop-blur-lg rounded-2xl border border-cyan-500/30 p-8 shadow-2xl shadow-cyan-500/20">
                <h2 className="text-2xl font-bold mb-6 text-center text-cyan-300">
                  NETWORK TOPOLOGY MAP
                </h2>
                <div className="relative min-h-96 flex items-center justify-center">
                  <div className="absolute inset-0 flex flex-col items-center justify-around">
                    {parsedHops.map((hop, index) => (
                      <div 
                        key={hop.number}
                        className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-500 ${
                          hop.latency 
                            ? `border-cyan-500/50 ${getLatencyGlow(hop.latency)} shadow-lg` 
                            : 'border-gray-600/50'
                        } bg-black/50 backdrop-blur-sm animate-fadeIn`}
                        style={{ animationDelay: `${index * 100}ms` }}
                      >
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 flex items-center justify-center font-bold text-black">
                          {hop.number}
                        </div>
                        <div className="min-w-48">
                          <div className="font-mono text-sm text-cyan-300">{hop.host}</div>
                          <div className={`font-mono text-xs mt-1 ${getLatencyColor(hop.latency)}`}>
                            {hop.times.join(', ') || 'N/A'}
                          </div>
                        </div>
                        {hop.latency && (
                          <div className={`text-xs px-2 py-1 rounded ${getLatencyColor(hop.latency)} bg-black/30`}>
                            {hop.latency}ms
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  {/* Connection lines */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    {parsedHops.slice(0, -1).map((_, index) => (
                      <line
                        key={index}
                        x1="50%"
                        y1={`${(index * (100 / (parsedHops.length - 1))) + (50 / parsedHops.length)}%`}
                        x2="50%"
                        y2={`${((index + 1) * (100 / (parsedHops.length - 1))) + (50 / parsedHops.length)}%`}
                        stroke="url(#gradient)"
                        strokeWidth="2"
                        className="animate-pulse"
                      />
                    ))}
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#00ffff" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity="0.8" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>
            )}

            {/* Data panels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Parsed hops table */}
              {parsedHops.length > 0 && (
                <div className="bg-gray-800/50 backdrop-blur-lg rounded-2xl border border-cyan-500/30 p-6 shadow-2xl shadow-cyan-500/20">
                  <h3 className="text-xl font-bold mb-4 text-cyan-300 flex items-center gap-2">
                    <span className="text-purple-400">⯈</span>
                    PARSED HOPS DATA
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-cyan-500/30">
                          <th className="py-3 px-4 text-left text-cyan-300">HOP</th>
                          <th className="py-3 px-4 text-left text-cyan-300">HOST/IP</th>
                          <th className="py-3 px-4 text-left text-cyan-300">LATENCY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedHops.map((hop) => (
                          <tr 
                            key={hop.number} 
                            className="border-b border-gray-700/50 hover:bg-cyan-500/10 transition-colors duration-200"
                          >
                            <td className="py-3 px-4 font-mono text-cyan-400">{hop.number}</td>
                            <td className="py-3 px-4 font-mono text-green-400">{hop.host}</td>
                            <td className={`py-3 px-4 font-mono ${getLatencyColor(hop.latency)}`}>
                              {hop.times.join(', ') || 'TIMEOUT'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Raw output terminal */}
              <div className="bg-gray-900/80 backdrop-blur-lg rounded-2xl border border-green-500/30 p-6 shadow-2xl shadow-green-500/20">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold text-green-400 flex items-center gap-2">
                    <span className="text-green-300">⯈</span>
                    RAW TERMINAL OUTPUT
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={copyOutput}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-cyan-300 rounded text-sm transition-colors"
                    >
                      COPY
                    </button>
                    <button
                      onClick={exportToFile}
                      className="px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded text-sm transition-colors"
                    >
                      EXPORT
                    </button>
                  </div>
                </div>
                <div className="bg-black/80 rounded-lg p-4 border border-green-500/30">
                  <pre className="text-green-400 text-sm leading-relaxed font-mono max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-cyan-500 scrollbar-track-gray-800">
                    {rawOutput || '> AWAITING SCAN DATA...'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating particles */}
      <div className="fixed inset-0 pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-cyan-400 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${10 + Math.random() * 10}s`
            }}
          ></div>
        ))}
      </div>
    </div>
  );
}

export default App;