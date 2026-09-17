import { useEffect, useState } from 'react';
import logo from '../assets/logo.svg';
import type { SplashProgress } from '../types/electron';

export function SplashScreen() {
  const [progress, setProgress] = useState<SplashProgress>({
    percent: 4,
    label: 'Uruchamianie ServiceOS…'
  });

  useEffect(() => window.lockOn.splash.onProgress(setProgress), []);

  return (
    <div className="splash-stage">
      <div className="splash-card">
        <div className="splash-glow splash-glow-one" />
        <div className="splash-glow splash-glow-two" />

        <div className="splash-topline">
          <div className="splash-logo-wrap"><img src={logo} alt="" className="splash-logo" /></div>
          <div className="splash-wordmark"><strong>LockOn</strong><span>ServiceOS</span></div>
        </div>

        <div className="splash-copy">
          <h1>Serwis pod kontrolą.</h1>
          <p>Przygotowuję Twoje środowisko pracy.</p>
        </div>

        <div className="splash-progress-copy">
          <span>{progress.label}</span>
          <strong>{progress.percent}%</strong>
        </div>
        <div className="splash-progress-track">
          <div className="splash-progress-fill" style={{ width: progress.percent + '%' }} />
        </div>

        <div className="splash-footer">
          <span className="live-dot" /> LockOn ServiceOS
        </div>
      </div>
    </div>
  );
}
