import { Headphones, MessageSquareText, ShieldCheck, UsersRound } from 'lucide-react';
import { ROLE_DEFINITIONS, type UserRole } from '../config/roles';

interface SupportDeskProps {
  role: UserRole;
  onOpenChat: () => void;
}

export function SupportDesk({ role, onOpenChat }: SupportDeskProps) {
  const isSupport = role === 'OWNER' || role === 'SUPPORT';

  return (
    <div className="support-page page-enter">
      <section className="support-hero">
        <div className="support-hero-icon"><Headphones size={28} /></div>
        <div>
          <div className="eyebrow light">LOCKON SUPPORT</div>
          <h1>Centrum wsparcia</h1>
          <p>
            Panel przeznaczony dla właściciela aplikacji i roli Wsparcie. Czat pomocy jest dostępny z boku aplikacji. Rola Wsparcie LockOnOS może być przypisana do konkretnych punktów przez Właściciela.
          </p>
        </div>
      </section>

      <section className="support-grid">
        <article className="panel-card support-card">
          <ShieldCheck size={22} />
          <span>Aktualna rola</span>
          <strong>{ROLE_DEFINITIONS[role].label}</strong>
          <small>{isSupport ? 'Dostęp do trybu obsługi wsparcia aktywny.' : 'Podgląd interfejsu bez realnych uprawnień wsparcia.'}</small>
        </article>
        <article className="panel-card support-card">
          <UsersRound size={22} />
          <span>Kolejka zgłoszeń</span>
          <strong>0</strong>
          <small>Gotowe miejsce pod zgłoszenia użytkowników z wielu punktów.</small>
        </article>
        <article className="panel-card support-card">
          <MessageSquareText size={22} />
          <span>Czat pomocy</span>
          <strong>LOCAL</strong>
          <button className="button primary" onClick={onOpenChat}>Otwórz czat</button>
        </article>
      </section>
    </div>
  );
}
