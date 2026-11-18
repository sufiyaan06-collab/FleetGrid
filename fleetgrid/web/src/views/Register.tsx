import { useState } from 'react';
import { useFleet } from '../store/FleetContext';
import { api } from '../lib/api';
import { cn } from '../lib/format';
import { BACKEND_LABEL } from '../lib/config';

type Kind = 'BUSINESS' | 'DRIVER';

interface FormState {
  name: string;
  contact: string;
  email: string;
  password: string;
  organizationName: string;
  registrationNo: string;
  capacityT: string;
  origin: string;
  destination: string;
  withTruck: boolean;
}

const EMPTY: FormState = {
  name: '',
  contact: '',
  email: '',
  password: '',
  organizationName: '',
  registrationNo: '',
  capacityT: '5',
  origin: 'Bengaluru',
  destination: 'Chennai',
  withTruck: true,
};

const KINDS: Array<{ id: Kind; label: string; kicker: string; blurb: string; creates: string }> = [
  {
    id: 'BUSINESS',
    label: 'Business / Shipper',
    kicker: 'I have cargo to move',
    blurb: 'Find spare capacity on the corridor, book a truck, and track your shipment.',
    creates: 'Creates a shipper organisation and your account.',
  },
  {
    id: 'DRIVER',
    label: 'Driver / Fleet Operator',
    kicker: 'I have a truck',
    blurb: 'Publish your spare capacity, then accept or decline the loads you want.',
    creates: 'Creates a fleet operator organisation, your driver profile, and optionally your truck.',
  },
];

const inputCls =
  'w-full rounded-md border border-base-600 bg-base-900/60 px-2.5 py-1.5 text-xs text-ink-100 outline-none transition-colors placeholder:text-ink-600 focus:border-healthy/60';
const labelCls = 'mb-1 block text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500';

/**
 * Self-service registration.
 *
 * Real self-service signup. The server stores a password hash and sends an
 * email-verification link; users cannot enter the application until verified.
 */
export function Register() {
  const { setMode, connection, error: connectionError } = useFleet();
  const [kind, setKind] = useState<Kind>('BUSINESS');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const capacityT = Number(form.capacityT);
      const result = await api.signup({
        role: kind,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        contact: form.contact.trim(),
        ...(form.organizationName.trim() ? { organizationName: form.organizationName.trim() } : {}),
        ...(kind === 'DRIVER' && form.withTruck
          ? {
              truck: {
                registrationNo: form.registrationNo.trim(),
                capacityT: Number.isFinite(capacityT) ? capacityT : 0,
                origin: form.origin.trim(),
                destination: form.destination.trim(),
              },
            }
          : {}),
      });
      setNotice(result.message);
      setForm(EMPTY);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = KINDS.find((k) => k.id === kind)!;
  const shownError = error ?? connectionError;

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-10">
      <div className="mb-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => void setMode('LANDING')}
          className="text-2xs font-medium uppercase tracking-[0.16em] text-ink-500 transition-colors hover:text-ink-300"
        >
          ← Back to Operations Hub
        </button>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-600">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connection === 'live' ? 'bg-healthy' : connection === 'offline' ? 'bg-danger' : 'bg-warn',
            )}
          />
          <span className="font-mono normal-case tracking-normal">{BACKEND_LABEL}</span>
        </span>
      </div>

      <h1 className="text-xl font-semibold tracking-tight text-ink-50">Create your FleetGrid account</h1>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
        Choose how you want to use the network. The server creates exactly the records your role needs.
      </p>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {KINDS.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={busy}
            onClick={() => setKind(option.id)}
            className={cn(
              'rounded-lg border p-3.5 text-left transition-all disabled:opacity-50',
              kind === option.id
                ? 'border-healthy/50 bg-healthy/[0.07]'
                : 'border-base-600 bg-base-800/60 hover:border-base-500',
            )}
          >
            <span className="eyebrow">{option.kicker}</span>
            <span className="mt-1 block text-sm font-semibold tracking-tight text-ink-50">{option.label}</span>
            <span className="mt-1.5 block text-[11px] leading-relaxed text-ink-400">{option.blurb}</span>
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 rounded-lg border border-base-700 bg-base-800/50 p-4">
        <p className="mb-3.5 text-[10px] leading-relaxed text-ink-500">{active.creates}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="reg-name">Full name</label>
            <input
              id="reg-name"
              className={inputCls}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={kind === 'DRIVER' ? 'Ravi Kumar' : 'Asha Rao'}
              required
              minLength={2}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="reg-email">Email address</label>
            <input
              id="reg-email"
              className={inputCls}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
              className={inputCls}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={10}
              placeholder="At least 10 characters"
              required
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="reg-contact">Phone number</label>
            <input
              id="reg-contact"
              className={inputCls}
              value={form.contact}
              onChange={(e) => set('contact', e.target.value)}
              placeholder="+91 90000 00000"
              autoComplete="tel"
              required
              minLength={3}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="reg-org">
              {kind === 'DRIVER' ? 'Fleet name (optional)' : 'Business name (optional)'}
            </label>
            <input
              id="reg-org"
              className={inputCls}
              value={form.organizationName}
              onChange={(e) => set('organizationName', e.target.value)}
              placeholder={kind === 'DRIVER' ? 'Ravi Transport' : 'Asha Textiles'}
            />
            <p className="mt-1 text-[10px] text-ink-600">
              Leave blank and we name it after you.
            </p>
          </div>
        </div>

        {kind === 'DRIVER' && (
          <div className="mt-4 border-t border-base-700 pt-3.5">
            <label className="mb-2.5 flex items-start gap-2 text-[11px] text-ink-300">
              <input
                type="checkbox"
                checked={form.withTruck}
                onChange={(e) => set('withTruck', e.target.checked)}
                className="mt-0.5 accent-healthy"
              />
              <span>
                Add my truck now
                <span className="mt-0.5 block text-[10px] text-ink-500">
                  Without a truck you can register, but you will have no loads to accept until one is assigned.
                </span>
              </span>
            </label>

            {form.withTruck && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls} htmlFor="reg-plate">Registration no.</label>
                  <input
                    id="reg-plate"
                    className={inputCls}
                    value={form.registrationNo}
                    onChange={(e) => set('registrationNo', e.target.value)}
                    placeholder="KA 05 AB 1234"
                    required={form.withTruck}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="reg-capacity">Capacity (tonnes)</label>
                  <input
                    id="reg-capacity"
                    className={inputCls}
                    value={form.capacityT}
                    onChange={(e) => set('capacityT', e.target.value)}
                    type="number"
                    min="0.5"
                    step="0.5"
                    required={form.withTruck}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="reg-origin">From</label>
                  <input
                    id="reg-origin"
                    className={inputCls}
                    value={form.origin}
                    onChange={(e) => set('origin', e.target.value)}
                    required={form.withTruck}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="reg-dest">To</label>
                  <input
                    id="reg-dest"
                    className={inputCls}
                    value={form.destination}
                    onChange={(e) => set('destination', e.target.value)}
                    required={form.withTruck}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {notice && (
          <div className="mt-3.5 rounded-md border border-healthy/40 bg-healthy/10 px-3 py-2 text-[11px] leading-relaxed text-healthy">
            {notice}
          </div>
        )}

        {shownError && (
          <div className="mt-3.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] leading-relaxed text-danger">
            {shownError}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className={cn(
            'mt-4 w-full rounded-md border border-healthy/40 bg-healthy/10 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-healthy transition-colors',
            'hover:bg-healthy/20 disabled:opacity-50',
          )}
        >
          {busy ? 'Creating account…' : `Create ${kind === 'DRIVER' ? 'Driver' : 'Business'} account`}
        </button>

        <p className="mt-3 text-[10px] leading-relaxed text-ink-500">
          You must verify your email before signing in. Passwords are never stored as plain text.
        </p>
      </form>
    </div>
  );
}
