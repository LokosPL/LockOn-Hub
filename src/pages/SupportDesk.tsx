import { Headphones, MessageSquareText, ShieldCheck } from 'lucide-react';
import type { UserRole } from '../config/roles';

interface SupportDeskProps {
  role: UserRole;
  onOpenChat: () => void;
}

export function SupportDesk({ role, onOpenChat }: SupportDeskProps) {
  const isSupport = role === 'OWNER' || role === 'SUPPORT';

  return (
    <div className="support-page page-enter">
      <section className="support-hero">
        <div>
          <div className="eyebrow"><span className="live-dot" /> POMOC LOCKON</div>
          <h1>Pomoc bez zajmowania całego ekranu.</h1>
          <p>Panel otwiera się z prawej strony i zostawia Ci widok aplikacji. Rozmowa jest zapisywana centralnie i przypisana wyłącznie do zalogowanego konta.</p>
          <button className="button primary" onClick={onOpenChat}>
            <MessageSquareText size={17} /> Otwórz pomoc
          </button>
        </div>
        <div className="support-hero-icon"><Headphones size={30} /></div>
      </section>

      <section className="support-grid compact-support-grid">
        <article className="panel-card support-card">
          <ShieldCheck size={20} />
          <span>Tryb</span>
          <strong>{isSupport ? 'Wsparcie aktywne' : 'Pomoc użytkownika'}</strong>
          <small>{isSupport ? 'Możesz pisać jako Wsparcie LockOn.' : 'Możesz opisać problem w panelu pomocy.'}</small>
        </article>
        <article className="panel-card support-card">
          <MessageSquareText size={20} />
          <span>Rozmowa</span>
          <strong>Prywatna · centralna</strong>
          <small>Historia jest pobierana z centralnego backendu dla bieżącego konta. Dostęp do danych nadal ograniczają role i punkty.</small>
        </article>
      </section>
    </div>
  );
}
