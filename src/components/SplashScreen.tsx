import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check, Database, LoaderCircle, MonitorUp, ShieldCheck, Sparkles } from 'lucide-react';
import logo from '../assets/logo.svg';
import type { SplashProgress } from '../types/electron';

const BOOT_STAGES = [
  { at: 12, label: 'Silnik', icon: Sparkles },
  { at: 36, label: 'Usługi', icon: Database },
  { at: 68, label: 'Interfejs', icon: MonitorUp },
  { at: 88, label: 'Sesja', icon: ShieldCheck }
] as const;

export function SplashScreen() {
  const [progress, setProgress] = useState<SplashProgress>({
    percent: 4,
    label: 'Uruchamianie ServiceOS…'
  });

  useEffect(() => window.lockOn.splash.onProgress(setProgress), []);

  const safePercent = Math.max(0, Math.min(100, progress.percent));
  const activeStage = useMemo(() => {
    let index = 0;
    BOOT_STAGES.forEach((stage, stageIndex) => {
      if (safePercent >= stage.at) index = stageIndex;
    });
    return index;
  }, [safePercent]);

  return (
    <div className="splash-stage">
      <div className="splash-card splash-card-v2">
        <div className="splash-grid" aria-hidden="true" />
        <div className="splash-glow splash-glow-one" />
        <div className="splash-glow splash-glow-two" />

        <div className="splash-topline">
          <div className="splash-brand-v2">
            <div className="splash-logo-orbit" aria-hidden="true">
              <i />
              <span><img src={logo} alt="" className="splash-logo" /></span>
            </div>
            <div className="splash-wordmark">
              <strong>LockOn</strong>
              <span>ServiceOS</span>
            </div>
          </div>
          <div className="splash-live"><span className="live-dot" /> SYSTEM STARTU</div>
        </div>

        <div className="splash-main-v2">
          <div className="splash-copy">
            <span className="splash-kicker">PRZYGOTOWUJĘ ŚRODOWISKO</span>
            <h1>Moment.<br/><em>Ładuję wszystko, czego potrzebujesz.</em></h1>
            <p>ServiceOS przygotowuje usługi, interfejs i Twoją sesję jeszcze przed pokazaniem głównego ekranu.</p>
          </div>

          <div className="splash-meter" aria-label={`Postęp uruchamiania: ${safePercent}%`}>
            <div className="splash-meter-ring" style={{ '--boot-progress': safePercent } as CSSProperties}>
              <div>
                <strong>{safePercent}</strong>
                <span>%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="splash-stage-row" aria-label="Etapy uruchamiania">
          {BOOT_STAGES.map((stage, index) => {
            const Icon = stage.icon;
            const done = safePercent >= (BOOT_STAGES[index + 1]?.at ?? 100);
            const active = index === activeStage && safePercent < 100;
            return (
              <div className={`splash-stage-chip ${done ? 'done' : ''} ${active ? 'active' : ''}`} key={stage.label}>
                <span>{done ? <Check size={13}/> : active ? <LoaderCircle className="spin" size={13}/> : <Icon size={13}/>}</span>
                <strong>{stage.label}</strong>
              </div>
            );
          })}
        </div>

        <div className="splash-progress-block">
          <div className="splash-progress-copy">
            <span>{progress.label}</span>
            <strong>{safePercent === 100 ? 'Gotowe' : 'Proszę chwilę poczekać'}</strong>
          </div>
          <div className="splash-progress-track">
            <div className="splash-progress-fill" style={{ width: safePercent + '%' }} />
            <i className="splash-progress-scan" aria-hidden="true" />
          </div>
        </div>

        <div className="splash-footer splash-footer-v2">
          <span><span className="live-dot" /> Bezpieczne uruchamianie</span>
          <span>LockOn ServiceOS</span>
        </div>
      </div>
    </div>
  );
}
