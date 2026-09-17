import { useEffect, useState } from 'react';
import logo from '../assets/logo.svg';
import { APP_META } from '../config/app';
import type { SplashProgress } from '../types/electron';

export function SplashScreen() {
  const [progress, setProgress] = useState<SplashProgress>({ percent: 4, label: 'Przygotowanie aplikacji…' });
  useEffect(() => window.lockOn.splash.onProgress(setProgress), []);
  return (
    <div className="splash-stage">
      <div className="splash-card">
        <div className="splash-glow splash-glow-one" />
        <div className="splash-glow splash-glow-two" />
        <div className="splash-logo-wrap"><img src={logo} alt="LockOn ServiceOS" className="splash-logo" /></div>
        <div className="splash-copy">
          <div className="eyebrow">{APP_META.location}</div>
          <h1>LockOn <span>ServiceOS</span></h1>
          <p>System obsługi serwisu telefonów</p>
        </div>
        <div className="splash-progress-copy"><span>{progress.label}</span><strong>{progress.percent}%</strong></div>
        <div className="splash-progress-track"><div className="splash-progress-fill" style={{ width: `${progress.percent}%` }} /></div>
        <div className="splash-footer">Bartłomiej Motłoch • Punkt Nowogard</div>
      </div>
    </div>
  );
}
