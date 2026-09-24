import { CalendarDays, Hand, MessageSquare, MonitorUp } from 'lucide-react';
import { MeetingsCard } from '../components/MeetingsCard';
import type { UserRole } from '../types/electron';

export function MeetingsPage({ role, focusMeetingId }: { role: UserRole; focusMeetingId?: string | null }) {
  return (
    <div className="meetings-page page-enter">
      <header className="meetings-page-hero meetings-page-hero-v2">
        <div className="meetings-page-hero-copy">
          <span><CalendarDays size={13}/> SPOTKANIA I SZKOLENIA</span>
          <h1>Rozmowy zespołu bez chaosu.</h1>
          <p>Planowanie, zapisy, prowadzenie pokoju, czat, udostępnianie ekranu, zgłoszenia do głosu i frekwencja pozostają w jednym miejscu.</p>
        </div>
        <div className="meetings-page-capabilities" aria-label="Możliwości modułu">
          <span><CalendarDays size={15}/><b>Terminarz</b><small>Spotkania i szkolenia</small></span>
          <span><MessageSquare size={15}/><b>Czat</b><small>Historia per spotkanie</small></span>
          <span><MonitorUp size={15}/><b>Ekrany</b><small>Przełączany podgląd</small></span>
          <span><Hand size={15}/><b>Zgłoszenia</b><small>Kolejka do głosu</small></span>
        </div>
      </header>
      <MeetingsCard role={role} focusMeetingId={focusMeetingId} />
    </div>
  );
}
