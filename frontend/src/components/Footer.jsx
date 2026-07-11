import React from 'react';
import crtImage from '../assets/crt.jpg';

function CRT() {
  return (
    <div
      className="relative h-[186px] w-[230px] rounded-tl-[18px] rounded-tr-[18px] rounded-br-[14px] rounded-bl-[14px] border p-4"
      style={{
        background: 'linear-gradient(160deg,#2a2320,#171310)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 8px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        borderColor: '#3a3028',
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-[10px]"
        style={{ background: '#1a0f03', boxShadow: 'inset 0 0 30px rgba(0,0,0,0.8)' }}
      >
        <div
          className="animate-flicker absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${crtImage})`, filter: 'saturate(1.15) brightness(1.05)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.5) 100%)' }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg,rgba(0,0,0,0.15) 0px,rgba(0,0,0,0.15) 1px,transparent 1px,transparent 3px)',
          }}
        />
        <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 24px rgba(232,145,60,0.15)' }} />
      </div>
      <div className="absolute bottom-1.5 right-3.5 flex items-center gap-1.5">
        <span className="animate-livePulse h-[5px] w-[5px] rounded-full bg-ember" />
      </div>
    </div>
  );
}

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-line bg-bg">
      <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-10 px-7 pb-12 pt-11">
        <div className="flex items-end gap-6">
          <CRT />
          <div className="pb-2.5">
            <div className="mb-2.5 flex items-center gap-[9px]">
              <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-line2 bg-panel2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M4 6l6 6-6 6" stroke="#F5EFE6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 6l6 6-6 6" stroke="#E8913C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="font-display text-[16px] font-bold">Dispatch</span>
            </div>
            <div className="max-w-[220px] text-[12.5px] leading-[1.5] text-muted2">
              The routing layer for the agent economy. Built on CROO CAP.
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <a
            href="https://github.com/solutionkanu12/dispatch"
            target="_blank"
            rel="noopener noreferrer"
            className="social-btn flex h-11 w-11 items-center justify-center rounded-[11px] border border-line2 text-cream2 no-underline"
            aria-label="GitHub"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.38.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.13-.3-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.8 5.65-5.48 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58C20.56 22.3 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
            </svg>
          </a>
          <a
            href="https://x.com/solution_o1"
            target="_blank"
            rel="noopener noreferrer"
            className="social-btn flex h-11 w-11 items-center justify-center rounded-[11px] border border-line2 text-cream2 no-underline"
            aria-label="X"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zm-1.29 19.5h2.04L6.48 3.24H4.29l13.32 17.41z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
