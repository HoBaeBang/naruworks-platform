// NaruWorks: header above the app, styled like the NaruWorks site header (frontend/src/components/layout/global-header.tsx),
// so members can get back to the NaruWorks home and other services.
import { useEffect, useRef, useState } from 'react';
import './naru-bar.css';

interface Nav { home: string | null; name: string; email: string }

const join = (home: string, path: string) => home.replace(/\/+$/, '') + path;

function Mark() {
  return (
    <span className="naru-mark" aria-hidden="true">
      <svg className="naru-mark-light" viewBox="0 0 64 64" fill="none">
        <rect x="2" y="2" width="60" height="60" rx="10" fill="#F4F7F5" />
        <path d="M16 15H25V49H16V15Z" fill="#20B977" />
        <path d="M25 15H32L49 49H40L25 19V15Z" fill="#15201D" />
        <path d="M40 15H49V49H40V15Z" fill="#15201D" />
        <path d="M27.5 37.5V48H38L27.5 37.5Z" fill="#15201D" />
      </svg>
      <svg className="naru-mark-dark" viewBox="0 0 64 64" fill="none">
        <rect x="2" y="2" width="60" height="60" rx="10" fill="#2A3A34" />
        <path d="M16 15H25V49H16V15Z" fill="#57DF9A" />
        <path d="M25 15H32L49 49H40L25 19V15Z" fill="#F4F7F5" />
        <path d="M40 15H49V49H40V15Z" fill="#F4F7F5" />
        <path d="M27.5 37.5V48H38L27.5 37.5Z" fill="#F4F7F5" />
      </svg>
    </span>
  );
}

export function NaruBar() {
  const [nav, setNav] = useState<Nav | null>(null);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/auth/nav', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<Nav>) : null))
      .then(setNav)
      .catch(() => setNav(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (e.target instanceof Node && !menu.current?.contains(e.target)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const home = nav?.home ?? null;
  return (
    <header className="naru-bar">
      <div className="naru-bar-inner">
        <div className="naru-bar-left">
          <a className="naru-bar-brand" href={home ?? '/'}>
            <Mark />
            NaruWorks
          </a>
          <span className="naru-bar-label">Naru 문서</span>
        </div>
        <div className="naru-bar-right">
          <nav className="naru-bar-nav" aria-label="NaruWorks 서비스">
            {home && <a href={join(home, '/calendar')}>캘린더</a>}
          </nav>
          {nav && (
            <div ref={menu} className="naru-bar-member">
              <button type="button" className="naru-bar-member-btn" aria-haspopup="menu" aria-expanded={open} aria-label="회원 메뉴" onClick={() => setOpen((o) => !o)}>
                <span className="naru-bar-avatar">{nav.name.slice(0, 1).toUpperCase()}</span>
                <span className="naru-bar-member-name">{nav.name}</span>
              </button>
              {open && (
                <section className="naru-bar-menu" role="menu">
                  <div className="naru-bar-menu-head">
                    <p>{nav.name}</p>
                    <p>{nav.email}</p>
                  </div>
                  {home && <a role="menuitem" href={home}>NaruWorks 홈</a>}
                  <a role="menuitem" className="naru-bar-logout" href="/auth/logout">로그아웃</a>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
