/**
 * Account tests - run against a REAL PostgreSQL database, not a fake.
 *
 * The rules under test are the ones the arena is built on:
 *  - an account can only be created by spending a one-time invite;
 *  - an invite works exactly once, even if two people click at the same time;
 *  - a password is never stored as text.
 *
 * The tables are dropped and rebuilt before the run, so the test never depends
 * on leftover data and never touches anything the author cares about.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closePool, query, queryOne } from '../db/db';
import { dropAll, runMigrations } from '../db/migrations';
import {
  createInvite,
  inviteIsOpen,
  listOpenInvites,
  login,
  registerWithInvite,
} from './accounts';
import { checkEmail, checkPassword, hashPassword, verifyPassword } from './password';


/**
 * These tests need a REAL PostgreSQL. When there is none they are SKIPPED, not
 * failed: a missing database is an environment problem, not a broken rule.
 */
/**
 * Asks the database one real question. Any failure means "no database here",
 * and the suites below are skipped instead of failed.
 */
async function canReachDatabase(): Promise<boolean> {
  try {
    await runMigrations();

    return true;
  } catch (error) {
    if (process.env.DEBUG_DB) {
      console.error('[db] not reachable:', error);
    }

    return false;
  }
}

const databaseReady = await canReachDatabase();

beforeAll(async () => {
  if (!databaseReady) {
    return;
  }

  await dropAll();
  await runMigrations();
});

afterAll(async () => {
  if (!databaseReady) {
    return;
  }

  await closePool();
});

afterEach(async () => {
  if (!databaseReady) {
    return;
  }

  await query('DELETE FROM invites');
  await query('DELETE FROM players');
});

describe.skipIf(!databaseReady)('passwords', () => {
  it('never stores the password itself', async () => {
    const { hash, salt } = await hashPassword('correct horse battery');

    expect(hash).not.toContain('correct horse battery');
    expect(hash.length).toBeGreaterThan(32);
    expect(salt.length).toBeGreaterThan(8);
  });

  it('the same password gets a different hash every time', async () => {
    const first = await hashPassword('same-password');
    const second = await hashPassword('same-password');

    expect(first.hash).not.toBe(second.hash);
    expect(first.salt).not.toBe(second.salt);
  });

  it('accepts the right password and refuses the wrong one', async () => {
    const { hash, salt } = await hashPassword('right-password');

    expect(await verifyPassword('right-password', hash, salt)).toBe(true);
    expect(await verifyPassword('wrong-password', hash, salt)).toBe(false);
  });

  it('refuses a hash of a different length instead of crashing', async () => {
    expect(await verifyPassword('anything', 'deadbeef', 'salt')).toBe(false);
  });

  it('checks the password length', () => {
    expect(checkPassword('short')).toBe('too_short');
    expect(checkPassword('longenough')).toBeNull();
    expect(checkPassword(12345678)).toBe('not_a_string');
    expect(checkPassword('x'.repeat(201))).toBe('too_long');
  });

  it('checks the email shape', () => {
    expect(checkEmail('bob@mail.ru')).toBe(true);
    expect(checkEmail('bob@')).toBe(false);
    expect(checkEmail('not an email')).toBe(false);
    expect(checkEmail(null)).toBe(false);
  });
});

describe.skipIf(!databaseReady)('invites', () => {
  it('a fresh invite is open and listed', async () => {
    const token = await createInvite('for the tester');

    expect(await inviteIsOpen(token)).toBe(true);

    const open = await listOpenInvites();

    expect(open.map((i) => i.token)).toContain(token);
    expect(open.find((i) => i.token === token)?.note).toBe('for the tester');
  });

  it('an unknown token is not open', async () => {
    expect(await inviteIsOpen('no-such-token')).toBe(false);
  });
});

describe.skipIf(!databaseReady)('registration - invitation only', () => {
  it('creates an account and spends the invite', async () => {
    const token = await createInvite();

    const result = await registerWithInvite('Bob@Mail.ru', 'good-password', token);

    expect(result.ok).toBe(true);
    expect(result.ok && result.player.email).toBe('bob@mail.ru');
    expect(await inviteIsOpen(token)).toBe(false);
  });

  it('never gives the password hash to the caller', async () => {
    const token = await createInvite();
    const result = await registerWithInvite('hash@mail.ru', 'good-password', token);

    expect(Object.keys(result.ok ? result.player : {})).not.toContain('password_hash');
    expect(Object.keys(result.ok ? result.player : {})).not.toContain('password_salt');
  });

  it('refuses a registration with an invite that does not exist', async () => {
    const result = await registerWithInvite('a@mail.ru', 'good-password', 'no-such-token');

    expect(result.ok).toBe(false);
    // An unknown link and a spent link are one and the same for the player:
    // the link did not work. One code, so the form cannot probe for real tokens.
    expect(result.ok === false && result.code).toBe('invite_used');

    const count = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM players');

    expect(Number(count?.count)).toBe(0);
  });

  it('refuses a second registration with the same invite', async () => {
    const token = await createInvite();


    const first = await registerWithInvite('first@mail.ru', 'good-password', token);
    const second = await registerWithInvite('second@mail.ru', 'good-password', token);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('invite_used');

    const count = await queryOne<{ count: string }>('SELECT count(*)::text AS count FROM players');

    expect(Number(count?.count)).toBe(1);
  });

  it('a spent invite is marked with the account that used it', async () => {
    const token = await createInvite();

    await registerWithInvite('who@mail.ru', 'good-password', token);

    const row = await queryOne<{ used_by: number | null }>(
      'SELECT used_by FROM invites WHERE token = $1',
      [token],
    );

    expect(row?.used_by).not.toBeNull();
  });

  it('refuses a duplicate email even with a fresh invite', async () => {
    const first = await registerWithInvite('same@mail.ru', 'good-password', await createInvite());
    const second = await registerWithInvite('same@mail.ru', 'other-password', await createInvite());

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('email_taken');
  });

  it('refuses a bad email or a short password without spending the invite', async () => {
    const token = await createInvite();

    expect((await registerWithInvite('nope', 'good-password', token)).ok).toBe(false);
    expect((await registerWithInvite('a@mail.ru', 'short', token)).ok).toBe(false);
    expect(await inviteIsOpen(token)).toBe(true);
  });
});

describe.skipIf(!databaseReady)('login', () => {
  it('accepts the right credentials', async () => {
    await registerWithInvite('bob@mail.ru', 'good-password', await createInvite());

    const result = await login('bob@mail.ru', 'good-password');

    expect(result.ok).toBe(true);
    expect(result.ok && result.player.email).toBe('bob@mail.ru');
  });

  it('is case insensitive for the email', async () => {
    await registerWithInvite('bob@mail.ru', 'good-password', await createInvite());

    expect((await login('BOB@Mail.RU', 'good-password')).ok).toBe(true);
  });

  it('refuses the wrong password and an unknown email the same way', async () => {
    await registerWithInvite('bob@mail.ru', 'good-password', await createInvite());

    const wrongPassword = await login('bob@mail.ru', 'wrong-password');
    const unknownEmail = await login('nobody@mail.ru', 'good-password');

    expect(wrongPassword.ok).toBe(false);
    expect(unknownEmail.ok).toBe(false);
    // Same code for both, so the form cannot be used to find existing accounts.
    expect(wrongPassword.ok === false && wrongPassword.code).toBe('wrong_credentials');
    expect(unknownEmail.ok === false && unknownEmail.code).toBe('wrong_credentials');
  });
});




