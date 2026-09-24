import { CalendarDays } from 'lucide-react';
import { MeetingsCard } from '../components/MeetingsCard';
import type { UserRole } from '../types/electron';

export function MeetingsPage({ role, focusMeetingId }: { role: UserRole; focusMeetingId?: string | null }) {
  const canManage = role === 'OWNER' || role === 'BOSS' || role === 'COORDINATOR';
  return (
    <div className="meetings-page page-enter">
      <header className="meetings-page-hero meetings-page-hero-v3">
        <div className="meetings-page-hero-copy">
          <span><CalendarDays size={13}/> SPOTKANIA I SZKOLENIA</span>
          <h1>{canManage ? 'Spotkania zespołu w jednym miejscu.' : 'Twoje spotkania i szkolenia.'}</h1>
          <p>{canManage
            ? 'Planuj spotkania, prowadź rozmowy i wracaj do historii bez przeładowania ekranu zbędnymi informacjami.'
            : 'Dołączaj do spotkań, sprawdzaj najbliższe terminy i korzystaj ze szkoleń dostępnych dla Ciebie.'}</p>
        </div>
      </header>
      <MeetingsCard role={role} focusMeetingId={focusMeetingId} />
    </div>
  );
}
