import { Activity } from "lucide-react";

const TracerHeader = () => {
  return (
    <header className="relative py-8 text-center">
      {/* Decorative lines */}
      <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      
      {/* Logo and title */}
      <div className="relative inline-flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <Activity className="h-8 w-8 text-primary animate-pulse" />
          <h1 className="cyber-title text-4xl md:text-5xl font-bold text-primary">
            TRACE<span className="text-primary/40">RT</span>
          </h1>
          <Activity className="h-8 w-8 text-primary animate-pulse" />
        </div>
        <p className="font-display text-xs tracking-[0.3em] text-muted-foreground uppercase">
          Network Path Analysis Terminal
        </p>
      </div>

      {/* Corner decorations */}
      <div className="absolute left-4 top-4 h-4 w-4 border-l-2 border-t-2 border-primary/50" />
      <div className="absolute right-4 top-4 h-4 w-4 border-r-2 border-t-2 border-primary/50" />
      <div className="absolute left-4 bottom-4 h-4 w-4 border-l-2 border-b-2 border-primary/50" />
      <div className="absolute right-4 bottom-4 h-4 w-4 border-r-2 border-b-2 border-primary/50" />
    </header>
  );
};

export default TracerHeader;
