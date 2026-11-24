import { useEffect, useState } from 'react';
import { useFleet } from '../store/FleetContext';
import { api } from '../lib/api';
import { cn } from '../lib/format';

const inputCls =
  'w-full rounded-md border border-base-600 bg-base-900/60 px-3 py-2 text-sm text-ink-100 outline-none transition-colors placeholder:text-ink-600 focus:border-healthy/60';
const labelCls = 'mb-1.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500';

export function Login() {
  const { adoptAccount, setMode } = useFleet();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const portalParam = new URLSearchParams(window.location.search).get('portal');
  const expectedRole = portalParam === 'BUSINESS' || portalParam === 'DRIVER' || portalParam === 'CONTROL_TOWER' ? portalParam : undefined;
  const portalLabel = expectedRole === 'BUSINESS' ? 'Shipper' : expectedRole === 'DRIVER' ? 'Driver' : expectedRole === 'CONTROL_TOWER' ? 'Admin / Operations' : 'FleetGrid';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const passwordToken = params.get('resetToken');
    if (token) {
      // Do not consume verification links on page load: email security scanners
      // often prefetch links. Require the user to press the Verify email button.
      setVerificationToken(token);
      setNotice('Your verification link is ready. Select Verify email to finish setting up your account.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (passwordToken) {
      setResetToken(passwordToken);
      setNotice('Choose a new password to complete your password reset.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const verifyEmail = async () => {
    if (!verificationToken) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyEmail(verificationToken);
      setNotice(result.message);
      setVerificationToken(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session = await api.login({ email: email.trim().toLowerCase(), password, ...(expectedRole ? { expectedRole } : {}) });
      adoptAccount(session.user.role === 'BUSINESS' ? 'BUSINESS' : session.user.role === 'DRIVER' ? 'DRIVER' : 'CONTROL_TOWER', session);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      if (message.toLowerCase().includes('verify your email')) {
        setNotice('Open the verification email first. If you need another link, use Resend verification below.');
      }
    } finally {
      setBusy(false);
    }
  };


  const requestPasswordReset = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.forgotPassword(email.trim().toLowerCase());
      setNotice(result.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitPasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetToken) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.resetPassword(resetToken, newPassword);
      setResetToken(null);
      setNewPassword('');
      setForgotMode(false);
      setNotice(result.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.resendVerification(email.trim().toLowerCase());
      setNotice(result.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <button type="button" onClick={() => void setMode('LANDING')} className="mb-6 self-start text-2xs uppercase tracking-[0.14em] text-ink-500 hover:text-ink-200">
        ← Back to FleetGrid
      </button>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-50">Sign in to {portalLabel}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-400">Use the email address and password registered for your {portalLabel} account.</p>
      {expectedRole === 'CONTROL_TOWER' && <div className="mt-4 rounded-md border border-healthy/25 bg-healthy/5 px-3 py-2.5 text-xs leading-relaxed text-ink-300"><strong className="text-healthy">Administrator access:</strong> only authorised Admin / Operations accounts can enter this workspace. Admin access is not available through public sign-up.</div>}
      <form onSubmit={resetToken ? submitPasswordReset : forgotMode ? (event) => { event.preventDefault(); void requestPasswordReset(); } : submit} className="mt-6 rounded-lg border border-base-700 bg-base-800/60 p-5">
        {!resetToken && <div>
          <label className={labelCls} htmlFor="login-email">Email address</label>
          <input id="login-email" className={inputCls} type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>}
        {!resetToken && !forgotMode && <div className="mt-4">
          <label className={labelCls} htmlFor="login-password">Password</label>
          <input id="login-password" className={inputCls} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" />
        </div>}
        {resetToken && <div className="mt-4">
          <label className={labelCls} htmlFor="new-password">New password</label>
          <input id="new-password" className={inputCls} type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 10 characters" />
        </div>}
        {error && <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        {notice && <div className="mt-4 rounded-md border border-healthy/40 bg-healthy/10 px-3 py-2 text-xs text-healthy">{notice}</div>}
        {verificationToken && (
          <button type="button" disabled={busy} onClick={() => void verifyEmail()} className="mt-4 w-full rounded-md border border-healthy/50 bg-healthy/15 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-healthy hover:bg-healthy/25 disabled:opacity-50">
            {busy ? 'Verifying…' : 'Verify email'}
          </button>
        )}
        {resetToken ? (
          <button type="submit" disabled={busy || newPassword.length < 10} className={cn('mt-5 w-full rounded-md border border-healthy/40 bg-healthy/10 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-healthy hover:bg-healthy/20 disabled:opacity-50')}>
            {busy ? 'Updating…' : 'Reset password'}
          </button>
        ) : forgotMode ? (
          <button type="button" disabled={busy || !email.trim()} onClick={() => void requestPasswordReset()} className="mt-5 w-full rounded-md border border-healthy/40 bg-healthy/10 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-healthy disabled:opacity-50">
            {busy ? 'Sending…' : 'Send password reset link'}
          </button>
        ) : (
          <>
            <button type="submit" disabled={busy} className={cn('mt-5 w-full rounded-md border border-healthy/40 bg-healthy/10 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-healthy hover:bg-healthy/20 disabled:opacity-50')}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" disabled={busy || !email.trim()} onClick={() => void resend()} className="mt-3 w-full text-xs text-ink-400 underline underline-offset-4 hover:text-ink-100 disabled:opacity-40">
              Resend verification email
            </button>
          </>
        )}
      </form>
      {!resetToken && <button type="button" onClick={() => { setForgotMode(value => !value); setError(null); setNotice(null); }} className="mt-4 text-center text-xs text-ink-400 underline underline-offset-4 hover:text-ink-100">
        {forgotMode ? 'Back to sign in' : 'Forgot password?'}
      </button>}
      <button type="button" onClick={() => void setMode('REGISTER')} className="mt-5 text-center text-xs text-healthy hover:text-healthy/80">
        New to FleetGrid? Create a shipper or driver account
      </button>
    </div>
  );
}
