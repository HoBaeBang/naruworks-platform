// NaruWorks: thin bar above the app so members can get back to the NaruWorks home and other services.
import { useEffect, useState } from 'react';
import './naru-bar.css';

interface Nav { home: string | null; name: string; email: string }

const join = (home: string, path: string) => home.replace(/\/+$/, '') + path;

export function NaruBar() {
  const [nav, setNav] = useState<Nav | null>(null);
  useEffect(() => {
    fetch('/auth/nav', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Nav>) : null))
      .then(setNav)
      .catch(() => setNav(null));
  }, []);

  const home = nav?.home ?? null;
  return (
    <header className="naru-bar">
      <a className="naru-bar-brand" href={home ?? '/'}>
        <svg viewBox="0 0 64 64" width="20" height="20" aria-hidden="true">
          <rect x="2" y="2" width="60" height="60" rx="10" fill="#F4F7F5" />
          <path d="M16 15H25V49H16V15Z" fill="#20B977" />
          <path d="M25 15H32L49 49H40L25 19V15Z" fill="#15201D" />
          <path d="M40 15H49V49H40V15Z" fill="#15201D" />
          <path d="M27.5 37.5V48H38L27.5 37.5Z" fill="#15201D" />
        </svg>
        <span>NaruWorks</span>
      </a>
      <nav className="naru-bar-nav" aria-label="NaruWorks 서비스">
        {home && <a href={join(home, '/calendar')}>캘린더</a>}
        <span className="naru-bar-current" aria-current="page">문서</span>
      </nav>
      <div className="naru-bar-user">
        {nav && <span title={nav.email}>{nav.name}</span>}
        <a href="/auth/logout">로그아웃</a>
      </div>
    </header>
  );
}
