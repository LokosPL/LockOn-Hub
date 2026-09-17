import { Minus, Square, X } from 'lucide-react';

interface TitleBarProps {
  pointName?: string;
}

export function TitleBar({ pointName = 'Punkt Nowogard' }: TitleBarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-mark" />
        <span className="titlebar-name">LockOn ServiceOS</span>
        <span className="titlebar-env">{pointName}</span>
      </div>
      <div className="window-actions">
        <button onClick={() => window.lockOn.window.minimize()} aria-label="Minimalizuj">
          <Minus size={15} />
        </button>
        <button onClick={() => window.lockOn.window.toggleMaximize()} aria-label="Maksymalizuj">
          <Square size={13} />
        </button>
        <button className="close-button" onClick={() => window.lockOn.window.close()} aria-label="Zamknij">
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
