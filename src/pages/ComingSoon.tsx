import { Construction } from 'lucide-react';

export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="coming-soon page-enter">
      <div className="coming-icon"><Construction size={32} /></div>
      <span className="eyebrow">Moduł przygotowany w strukturze projektu</span>
      <h1>{title}</h1>
      <p>
        Ten ekran jest już podpięty do nawigacji. Funkcjonalność dołożymy w kolejnych etapach
        bez przebudowywania fundamentów aplikacji.
      </p>
    </section>
  );
}
