import { useState, type ReactNode } from 'react';
import { cn } from '../lib/format';
import { useFleet } from '../store/FleetContext';
import { ElevenLabsVoiceAssistant } from './ElevenLabsVoiceAssistant';
import type { ConnectionStatus } from '../lib/realtime';
import type { Mode } from '../lib/types';

const CONNECTION_COPY: Record<ConnectionStatus, { label: string; dot: string }> = {
  connecting: { label: 'Connecting', dot: 'bg-amber-500' },
  live: { label: 'Network live', dot: 'bg-emerald-500' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-amber-500' },
  offline: { label: 'Offline', dot: 'bg-rose-500' },
};

const MODES: Array<{ id: Mode; label: string; short: string; icon: string }> = [
  { id: 'LANDING', label: 'Landing', short: 'Landing', icon: '⌂' },
  { id: 'CONTROL_TOWER', label: 'Control tower', short: 'Control tower', icon: '▦' },
  { id: 'LIVE_MAP', label: 'Live tracking', short: 'Live tracking', icon: '⌖' },
  { id: 'BUSINESS', label: 'Shipments', short: 'Shipments', icon: '⇄' },
  { id: 'PAYMENTS', label: 'Payments', short: 'Payments', icon: '▤' },
  { id: 'DRIVER', label: 'Driver workspace', short: 'Driver workspace', icon: '▣' },
];

interface AppHeaderProps { children?: ReactNode; }

export function AppHeader({ children }: AppHeaderProps) {
  const { connection, mode, setMode, session, signOut } = useFleet();
  const [voiceAssistantOpen, setVoiceAssistantOpen] = useState(false);
  const copy = CONNECTION_COPY[connection];
  const homeMode: Mode = session?.user.role === 'DRIVER'
    ? 'DRIVER'
    : session?.user.role === 'BUSINESS'
      ? 'BUSINESS'
      : 'CONTROL_TOWER';
  const visibleModes = !session
    ? MODES
    : session.user.role === 'DRIVER'
      ? MODES.filter((item) => ['DRIVER', 'LIVE_MAP'].includes(item.id))
      : session.user.role === 'BUSINESS'
        ? MODES.filter((item) => ['BUSINESS', 'PAYMENTS', 'LIVE_MAP'].includes(item.id))
        : MODES.filter((item) => ['CONTROL_TOWER', 'PAYMENTS', 'LIVE_MAP'].includes(item.id));
  const goHome = () => void setMode(session?.mode === 'authenticated' ? homeMode : 'LANDING');

  return (
    <>
      <aside className="fg-sidebar">
        <button type="button" onClick={goHome} className="fg-brand" title="FleetGrid workspace">
          <FleetMark />
          <span className="min-w-0 text-left">
            <strong>FLEETGRID</strong>
            <small>LOGISTICS INTELLIGENCE</small>
          </span>
        </button>

        <div className="fg-workspace">
          <span className="fg-workspace-mark">{(session?.organization?.name ?? 'F').slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0">
            <small>WORKSPACE</small>
            <strong>{session?.organization?.name ?? 'FleetGrid Network'}</strong>
          </span>
          <span className="fg-chevron">⌄</span>
        </div>

        <div className="fg-nav-label">WORKSPACE</div>
        <nav className="fg-nav" aria-label="Main navigation">
          {visibleModes.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void setMode(item.id)}
              aria-current={mode === item.id ? 'page' : undefined}
              className={cn('fg-nav-item', mode === item.id && 'is-active')}
            >
              <span className="fg-nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === 'LIVE_MAP' && <span className="fg-nav-live" />}
            </button>
          ))}
        </nav>

        <div className="fg-sidebar-spacer" />
        <div className="fg-connection">
          <span className={cn('fg-connection-dot', copy.dot)} />
          <span>{copy.label}</span>
          <span className="fg-connection-meta">{connection === 'live' ? '●' : '○'}</span>
        </div>
        <button type="button" onClick={() => setVoiceAssistantOpen(true)} className="fg-voice-button">
          <span aria-hidden="true">✦</span> AI voice assistant
        </button>
        {session?.mode === 'authenticated' && (
          <div className="fg-account">
            <span className="fg-avatar">{session.user.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <strong>{session.user.name}</strong>
              <small>{session.user.role === 'BUSINESS' ? 'Shipper account' : session.user.role === 'DRIVER' ? 'Driver account' : 'Operations account'}</small>
            </span>
            <button type="button" onClick={() => void signOut()} className="fg-signout" title="Sign out" aria-label="Sign out">↗</button>
          </div>
        )}
        {children}
      </aside>
      <div className="fg-mobilebar">
        <button type="button" onClick={goHome} className="fg-mobile-brand"><FleetMark /><strong>FLEETGRID</strong></button>
        <span className="fg-mobile-status"><i className={cn('fg-connection-dot', copy.dot)} />{copy.label}</span>
        <nav className="fg-mobile-nav" aria-label="Mobile navigation">
          {visibleModes.map((item) => (
            <button key={item.id} type="button" onClick={() => void setMode(item.id)} className={cn('fg-mobile-nav-item', mode === item.id && 'is-active')}>
              <span aria-hidden="true">{item.icon}</span>{item.short}
            </button>
          ))}
          <button type="button" onClick={() => setVoiceAssistantOpen(true)} className="fg-mobile-nav-item">✦ AI voice</button>
          {session?.mode === 'authenticated' && <button type="button" onClick={() => void signOut()} className="fg-mobile-nav-item">Sign out</button>}
        </nav>
      </div>
      <ElevenLabsVoiceAssistant isOpen={voiceAssistantOpen} onClose={() => setVoiceAssistantOpen(false)} />
    </>
  );
}

function FleetMark() {
  return (
    <span className="fg-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M4 10 16 4l12 6-12 6L4 10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="m4 16 12 6 12-6M4 22l12 6 12-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" opacity=".65" />
      </svg>
    </span>
  );
}
