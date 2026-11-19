import { db } from '../src/store/db.js';
import { hashPassword } from '../src/services/authSecurity.js';
import { newId, nowIso } from '../src/lib/ids.js';
import type { AuthAccount, Role, User } from '../src/types.js';

const email = process.env.OPS_EMAIL?.trim().toLowerCase();
const password = process.env.OPS_PASSWORD;
const name = process.env.OPS_NAME?.trim();
const roleValue = process.env.OPS_ROLE ?? 'OPERATOR';
const allowedRoles: Role[] = ['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'];

if (!email || !password || !name) {
  throw new Error('Set OPS_EMAIL, OPS_PASSWORD, and OPS_NAME before running this command.');
}
if (!allowedRoles.includes(roleValue as Role)) {
  throw new Error('OPS_ROLE must be CONTROL_TOWER, OPERATOR, or VERIFIER.');
}
if (password.length < 10 || password.length > 128) {
  throw new Error('OPS_PASSWORD must be between 10 and 128 characters.');
}

await db.initialize();
try {
  const existing = await db.authAccounts.find((account) => account.email === email);
  if (existing.length) throw new Error('An account with this email already exists.');

  const user: User = {
    id: newId('usr'),
    name,
    role: roleValue as Role,
    organizationId: 'fleetgrid_operations',
    contact: email,
    createdAt: nowIso(),
  };
  const timestamp = nowIso();
  const operationsOrganization = await db.organizations.findById('fleetgrid_operations');
  if (!operationsOrganization) {
    await db.organizations.create({
      id: 'fleetgrid_operations',
      name: 'FleetGrid Operations',
      type: 'FLEET_OPERATOR',
      status: 'ACTIVE',
      createdAt: timestamp,
    });
  }
  const account: AuthAccount = {
    id: user.id,
    email,
    passwordHash: await hashPassword(password),
    // Operations users are explicitly provisioned by an administrator.
    emailVerifiedAt: timestamp,
    verificationTokenHash: null,
    verificationExpiresAt: null,
    sessionTokenHash: null,
    sessionExpiresAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.users.create(user);
  try {
    await db.authAccounts.create(account);
  } catch (error) {
    await db.users.delete(user.id);
    throw error;
  }
  process.stdout.write(`Provisioned ${roleValue} account for ${email}. The user can now sign in.\n`);
} finally {
  await db.close();
}
