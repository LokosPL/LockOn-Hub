import { MeetingsCard } from '../components/MeetingsCard';
import type { UserRole } from '../types/electron';

export function MeetingsPage({ role, focusMeetingId }: { role: UserRole; focusMeetingId?: string | null }) {
  return (
    <div className="meetings-page page-enter">
      <header className="meetings-page-hero">
        <div>
          <span>SPOTKANIA I SZKOLENIA</span>
          <h1>Rozmowy, szkolenia i odprawy zespołu.</h1>
          <p>Terminy, zapisy, prowadzenie spotkania, chat, udostępnianie ekranu, zgłoszenia do głosu i frekwencja są w jednym module.</p>
        </div>
      </header>
      <MeetingsCard role={role} focusMeetingId={focusMeetingId} />
    </div>
  );
}
