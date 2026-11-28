import assert from 'node:assert/strict';
import {
  hashOpaqueToken,
  hashPassword,
  issueSessionToken,
  readSessionCookie,
  verifyPassword,
} from '../src/services/authSecurity.js';

const password = 'FleetGrid-Secure-Password-2026';
const stored = await hashPassword(password);
assert.match(stored, /^scrypt:[a-f0-9]+:[a-f0-9]+$/);
assert.equal(await verifyPassword(password, stored), true, 'correct password verifies');
assert.equal(await verifyPassword('not-the-password', stored), false, 'wrong password is rejected');

const session = issueSessionToken();
assert.notEqual(session.token, session.tokenHash, 'raw session token is not the stored hash');
assert.equal(hashOpaqueToken(session.token), session.tokenHash, 'session hash is reproducible');
assert.equal(
  readSessionCookie(`other=value; fleetgrid_session=${session.token}; theme=dark`),
  session.token,
  'session cookie is parsed from a multi-cookie header',
);
assert.equal(readSessionCookie('fleetgrid_session=invalid'), null, 'malformed session tokens are rejected');

process.stdout.write('Authentication security unit checks passed.\n');
