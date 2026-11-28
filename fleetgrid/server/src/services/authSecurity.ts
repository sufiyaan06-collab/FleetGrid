import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { connect as tlsConnect } from 'node:tls';
import { promisify } from 'node:util';
import { ApiError } from '../lib/errors.js';
import { isProductionEnvironment } from '../config.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'fleetgrid_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface IssuedToken {
  token: string;
  tokenHash: string;
  expiresAt: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split(':');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = (await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueToken(ttlMs: number): IssuedToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

export const issueSessionToken = (): IssuedToken => issueToken(SESSION_TTL_MS);
export const issueVerificationToken = (): IssuedToken => issueToken(VERIFY_TTL_MS);
export const issuePasswordResetToken = (): IssuedToken => issueToken(PASSWORD_RESET_TTL_MS);

export function setSessionCookie(res: { setHeader(name: string, value: string): void }, token: string): void {
  const production = isProductionEnvironment();
  const secure = production ? '; Secure' : '';
  const sameSite = 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
}

export function clearSessionCookie(res: { setHeader(name: string, value: string): void }): void {
  const production = isProductionEnvironment();
  const secure = production ? '; Secure' : '';
  const sameSite = production ? 'None' : 'Lax';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`);
}


type MailMessage = { from: string; to: string; subject: string; text: string };

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

async function sendWithGmailSmtp(message: MailMessage): Promise<void> {
  const host = process.env.SMTP_HOST?.trim() || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 465);
  const username = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASS?.replace(/\s/g, '');
  if (!username || !password || host !== 'smtp.gmail.com' || port !== 465) {
    throw new ApiError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'Gmail SMTP requires smtp.gmail.com on port 465 with SMTP_USER and SMTP_PASS.');
  }

  const socket = tlsConnect({ host, port, servername: host });
  socket.setEncoding('utf8');
  let incoming = '';
  let responseLines: string[] = [];
  const responses: string[] = [];
  const waiters: Array<(value: string) => void> = [];
  socket.on('data', (chunk: string) => {
    incoming += chunk;
    const lines = incoming.split('\r\n');
    incoming = lines.pop() ?? '';
    for (const line of lines) {
      responseLines.push(line);
      if (/^\\d{3} /.test(line)) {
        const response = responseLines.join('\n');
        responseLines = [];
        const waiter = waiters.shift();
        if (waiter) waiter(response); else responses.push(response);
      }
    }
  });
  const readResponse = () => new Promise<string>((resolve, reject) => {
    if (responses.length) return resolve(responses.shift()!);
    const timer = setTimeout(() => reject(new Error('SMTP timeout')), 15000);
    waiters.push((value) => { clearTimeout(timer); resolve(value); });
    socket.once('error', reject);
  });
  const command = async (value: string, expected: number) => {
    socket.write(value + '\r\n');
    const response = await readResponse();
    if (!response.startsWith(String(expected))) throw new Error('SMTP command rejected');
  };

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    if (!(await readResponse()).startsWith('220')) throw new Error('SMTP greeting rejected');
    await command('EHLO fleetgrid', 250);
    await command('AUTH LOGIN', 334);
    await command(Buffer.from(username).toString('base64'), 334);
    await command(Buffer.from(password).toString('base64'), 235);
    const sender = message.from.replace(/^.*<([^>]+)>.*$/, '$1').trim();
    await command(`MAIL FROM:<${sender}>`, 250);
    await command(`RCPT TO:<${message.to}>`, 250);
    await command('DATA', 354);
    const clean = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
    const body = [
      `From: FleetGrid <${sender}>`,
      `To: <${message.to}>`,
      `Subject: ${clean(message.subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      message.text.replace(/\r?\n/g, '\r\n').replace(/^\\./gm, '..'),
    ].join('\r\n');
    socket.write(body + '\r\n.\r\n');
    if (!(await readResponse()).startsWith('250')) throw new Error('SMTP message rejected');
    socket.write('QUIT\r\n');
  } catch {
    throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'Gmail could not send this email. Check the Gmail app password and SMTP settings in Render.');
  } finally {
    socket.end();
  }
}

async function sendEmail(message: MailMessage): Promise<void> {
  if (smtpConfigured()) {
    await sendWithGmailSmtp(message);
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new ApiError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'Configure Gmail SMTP or a verified email provider, plus APP_BASE_URL.');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
  });
  if (!response.ok) throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'FleetGrid could not send the email. Check the configured email provider.');
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  assertEmailProviderConfigured();
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new ApiError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'APP_BASE_URL is required.');
  let url: URL;
  try {
    url = new URL('/', baseUrl);
    url.searchParams.set('resetToken', token);
  } catch {
    throw new ApiError(503, 'EMAIL_CONFIGURATION_INVALID', 'APP_BASE_URL must be a valid absolute URL.');
  }
  await sendEmail({
    from: smtpConfigured() ? process.env.SMTP_USER!.trim() : process.env.EMAIL_FROM!.trim(),
    to: email,
    subject: 'Reset your FleetGrid password',
    text: [`Reset your FleetGrid password by opening this link: ${url.toString()}`, '', 'This link expires in 1 hour. If you did not request this, ignore this email.'].join('\n'),
  });
}

export function readSessionCookie(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return /^[A-Za-z0-9_-]{40,}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function assertEmailProviderConfigured(): void {
  const hasSmtp = smtpConfigured();
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
  if ((!hasSmtp && !hasResend) || !process.env.APP_BASE_URL?.trim()) {
    throw new ApiError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'Set SMTP_USER and SMTP_PASS for Gmail SMTP, or configure a verified email provider, plus APP_BASE_URL.');
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  assertEmailProviderConfigured();
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new ApiError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'APP_BASE_URL is required.');
  let url: URL;
  try {
    url = new URL('/', baseUrl);
    url.searchParams.set('token', token);
  } catch {
    throw new ApiError(503, 'EMAIL_CONFIGURATION_INVALID', 'APP_BASE_URL must be a valid absolute URL.');
  }
  await sendEmail({
    from: process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER!.trim(),
    to: email,
    subject: 'Verify your FleetGrid email',
    text: `Verify your FleetGrid account by opening this link: ${url.toString()}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
  });
}
