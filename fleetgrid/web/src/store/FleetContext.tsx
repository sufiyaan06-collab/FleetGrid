import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib/api';
import { flashKindFor, type FlashKind } from '../lib/flash';
import { useRealtime, type ConnectionStatus } from '../lib/realtime';
import type { DemoLoginResponse, FleetSnapshot, Mode, RealtimeEventType } from '../lib/types';

const EMPTY_SNAPSHOT: FleetSnapshot = {
  generatedAt: '',
  organizations: [],
  users: [],
  drivers: [],
  trucks: [],
  shipments: [],
  capacityOffers: [],
  incidents: [],
  recoveryPlans: [],
  payments: [],
  events: [],
  notifications: [],
};

/** Realtime messages that invalidate the client cache and require a refetch. */
const REFETCH_EVENTS: ReadonlySet<RealtimeEventType> = new Set<RealtimeEventType>([
  'demo.reset',
  'truck.updated',
  'driver.updated',
  'shipment.created',
  'shipment.updated',
  'capacity.updated',
  'incident.created',
  'incident.updated',
  'recovery.updated',
  'payment.updated',
  'notification.created',
]);

const MODE_STORAGE_KEY = 'fleetgrid.mode';

interface FleetContextValue {
  snapshot: FleetSnapshot;
  loading: boolean;
  error: string | null;
  connection: ConnectionStatus;
  mode: Mode | null;
  session: DemoLoginResponse | null;
  lastEvent: { type: string; at: number } | null;
  /** Highlights rows touched by the most recent realtime event. */
  flashIds: string[];
  /**
   * Tone for the rows in `flashIds`, derived from the event that triggered the
   * refetch. A decline flashes amber, not green, so a rejection never reads as a
   * completed action.
   */
  flashTone: FlashKind;
  refresh: () => Promise<void>;
  setMode: (mode: Mode) => Promise<void>;
  /**
   * Enters a mode using an account that already exists, instead of re-running
   * `POST /auth/demo-login`. This is how a freshly registered user becomes the
   * active session, so the app acts as *them* rather than as a seeded user.
   */
  adoptAccount: (mode: Mode, session: DemoLoginResponse) => void;
  resetDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  lastEventLabel: string | null;
}

const FleetContext = createContext<FleetContextValue | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<FleetSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode | null>(() => readStoredMode());
  const [session, setSession] = useState<DemoLoginResponse | null>(null);
  const [lastEvent, setLastEvent] = useState<{ type: string; at: number } | null>(null);
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [flashTone, setFlashTone] = useState<FlashKind>('ok');
  // Capture the route selected during the first render. Child effects may
  // remove a one-time verification token from the URL before this provider's
  // session-restoration effect runs.
  const initialModeRef = useRef(mode);

  const pendingRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.state();
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Realtime events never mutate local state directly — they only mark the cache
   * stale and trigger a refetch of the authoritative server snapshot.
   */
  const handleMessage = useCallback(
    (message: { type: string; payload: unknown }) => {
      setLastEvent({ type: message.type, at: Date.now() });

      if (message.type === 'connected') {
        void refresh();
        return;
      }

      if (REFETCH_EVENTS.has(message.type as RealtimeEventType)) {
        const payload = message.payload as { id?: string; truckId?: string; shipmentId?: string } | null;
        const ids = [payload?.id, payload?.truckId, payload?.shipmentId].filter(
          (v): v is string => typeof v === 'string',
        );
        if (ids.length) {
          setFlashIds(ids);
          setFlashTone(flashKindFor(message.type));
          if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
          flashTimerRef.current = window.setTimeout(() => setFlashIds([]), 1600);
        }

        if (pendingRef.current) window.clearTimeout(pendingRef.current);
        pendingRef.current = window.setTimeout(() => {
          pendingRef.current = null;
          void refresh();
        }, 80);
      }
    },
    [refresh],
  );

  const connection = useRealtime({ onMessage: handleMessage, onOpen: () => void refresh() });

  useEffect(() => {
    let active = true;
    // Preserve the verification-link route while restoring an absent session.
    // The Login screen consumes the query token only after explicit user action.
    const shouldPreserveLogin = initialModeRef.current === 'LOGIN';
    void api.me().then((account) => {
      if (!active) return;
      const nextMode = account.user.role === 'BUSINESS'
        ? 'BUSINESS'
        : account.user.role === 'DRIVER'
          ? 'DRIVER'
          : 'CONTROL_TOWER';
      const restored: DemoLoginResponse = {
        ok: true,
        mode: 'authenticated',
        user: account.user,
        organization: account.organization,
        driver: account.driver,
        availableRoles: [account.user.role],
      };
      setSession(restored);
      setModeState(nextMode);
      void refresh();
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, nextMode);
      } catch {
        /* private mode: ignore */
      }
    }).catch(() => {
      // No valid credential session: never reopen a stale locally remembered role.
      if (!active) return;
      setModeState(shouldPreserveLogin ? 'LOGIN' : 'LANDING');
      setSession(null);
      try {
        window.localStorage.removeItem(MODE_STORAGE_KEY);
      } catch {
        /* private mode: ignore */
      }
    });
    return () => { active = false; };
  }, [refresh]);

  useEffect(
    () => () => {
      if (pendingRef.current) window.clearTimeout(pendingRef.current);
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const setMode = useCallback(
    async (next: Mode) => {
      // Production operational workspaces always require a real account session.
      // Keep demo role entry available only in local development.
      if (
        !session &&
        import.meta.env.PROD &&
        ['CONTROL_TOWER', 'BUSINESS', 'DRIVER', 'PAYMENTS'].includes(next)
      ) {
        setModeState('LOGIN');
        try {
          window.localStorage.setItem(MODE_STORAGE_KEY, 'LOGIN');
        } catch {
          /* private mode: ignore */
        }
        return;
      }

      // Drivers cannot enter the shipper settlement workspace.
      if (next === 'PAYMENTS' && session?.user.role === 'DRIVER') {
        setModeState('DRIVER');
        try {
          window.localStorage.setItem(MODE_STORAGE_KEY, 'DRIVER');
        } catch {
          /* private mode: ignore */
        }
        return;
      }

      setModeState(next);
      // Harmless UI preference only — never fleet data.
      try {
        window.localStorage.setItem(MODE_STORAGE_KEY, next);
      } catch {
        /* private mode: ignore */
      }
      try {
        // REGISTER, LIVE_MAP, PAYMENTS, and LANDING are screens, so there is no seeded role to log into for them.
        if (next === 'REGISTER' || next === 'LIVE_MAP' || next === 'PAYMENTS' || next === 'LANDING' || next === 'LOGIN') return;
        // An authenticated user changes screens inside their existing session; never replace it with a demo identity.
        if (session?.mode === 'authenticated') {
          await refresh();
          return;
        }
        const login = await api.demoLogin(next);
        setSession(login);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [refresh, session],
  );

  const adoptAccount = useCallback((next: Mode, account: DemoLoginResponse) => {
    setModeState(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      /* private mode: ignore */
    }
    setSession(account);
    setError(null);
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession(null);
      setModeState('LANDING');
      setSnapshot(EMPTY_SNAPSHOT);
      try {
        window.localStorage.removeItem(MODE_STORAGE_KEY);
      } catch {
        /* private mode: ignore */
      }
    }
  }, []);

  const resetDemo = useCallback(async () => {
    setLoading(true);
    try {
      await api.resetDemo();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const lastEventLabel = useMemo(() => {
    if (!lastEvent) return null;
    const age = Date.now() - lastEvent.at;
    return `${lastEvent.type} · ${new Date(lastEvent.at).toLocaleTimeString('en-GB')} (${Math.round(age / 100) / 10}s ago)`;
  }, [lastEvent]);

  const value: FleetContextValue = {
    snapshot,
    loading,
    error,
    connection,
    mode,
    session,
    lastEvent,
    flashIds,
    flashTone,
    refresh,
    setMode,
    adoptAccount,
    resetDemo,
    signOut,
    lastEventLabel,
  };

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleet(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet must be used inside <FleetProvider>');
  return ctx;
}

function readStoredMode(): Mode | null {
  if (new URLSearchParams(window.location.search).has('token')) return 'LOGIN';
  try {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (
      stored === 'LANDING' ||
      stored === 'CONTROL_TOWER' ||
      stored === 'LIVE_MAP' ||
      stored === 'PAYMENTS' ||
      stored === 'BUSINESS' ||
      stored === 'DRIVER' ||
      stored === 'REGISTER' ||
      stored === 'LOGIN'
    ) {
      return stored as Mode;
    }
  } catch {
    /* ignore */
  }
  return null;
}
