/**
 * Accounts: registration by invitation only, and login (ADR 027).
 *
 * The rule that defines the arena: there is NO open registration. An account
 * can only be created by spending a one-time invite token that the author hands
 * out. An invite that has been used cannot be reused, so an old link in a chat
 * or in a screenshot stops working after the first person takes it.
 *
 * Every function returns a plain result object instead of throwing, because a
 * refused action is a normal outcome here: "wrong password", "invite already
 * used" - the route shows the reason to the player.
 */

import { randomBytes } from 'node:crypto';

import { query, queryOne, withTransaction } from '../db/db';
import {
  checkEmail,
  checkPassword,
  hashPassword,
  normalizeEmail,
  verifyPassword,
  type PasswordProblem,
} from './password';

/** One row of the players table. */
export type PlayerRow = {
  id: number;
  email: string;
  password_hash: string;
  password_salt: string;
  hero_type_id: string | null;
  charisma: number;
  created_at: Date;
};

/** The public shape of a player: never includes the password hash or salt. */
export type PublicPlayer = {
  id: number;
  email: string;
  heroTypeId: string | null;
  charisma: number;
};

/** Why an account action was refused. The UI shows this to the player. */
export type AuthError =
  | 'bad_email'
  | 'bad_password'
  | 'invite_missing'
  | 'invite_used'
  | 'email_taken'
  | 'wrong_credentials';

export type AuthResult =
  | { ok: true; player: PublicPlayer }
  | { ok: false; code: AuthError; message: string };

const MESSAGES: Record<AuthError, string> = {
  bad_email: 'Похоже, это не почта',
  bad_password: 'Пароль должен быть не короче 8 символов',
  invite_missing: 'Ссылка-приглашение не найдена',
  invite_used: 'Эта ссылка уже использована',
  email_taken: 'Эта почта уже зарегистрирована',
  wrong_credentials: 'Неверная почта или пароль',
};

function fail(code: AuthError): AuthResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/** Strips the password fields before a player leaves the server. */
function toPublic(row: PlayerRow): PublicPlayer {
  return {
    id: row.id,
    email: row.email,
    heroTypeId: row.hero_type_id,
    charisma: row.charisma,
  };
}

/** Creates an invite token. Only the author runs this (ADR 027). */
export async function createInvite(note?: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');

  await query('INSERT INTO invites (token, note) VALUES ($1, $2)', [token, note ?? null]);

  return token;
}

/** Lists open invites, newest first. For the author's own eyes. */
export async function listOpenInvites(): Promise<
  { token: string; note: string | null; createdAt: Date }[]
> {
  const rows = await query<{
    token: string;
    note: string | null;
    created_at: Date;
  }>(
    `SELECT token, note, created_at FROM invites
      WHERE used_at IS NULL
      ORDER BY created_at DESC`,
  );

  return rows.map((row) => ({
    token: row.token,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/** True when the token exists and has not been spent yet. */
export async function inviteIsOpen(token: string): Promise<boolean> {
  const row = await queryOne<{ token: string }>(
    'SELECT token FROM invites WHERE token = $1 AND used_at IS NULL',
    [token],
  );

  return row !== null;
}

/**
 * Creates an account, spending the invite.
 *
 * The insert of the player and the marking of the invite happen in ONE
 * transaction: if two people click the same link at the same moment, exactly
 * one of them gets the account and the other is refused with invite_used.
 */
export async function registerWithInvite(
  email: string,
  password: string,
  inviteToken: string,
): Promise<AuthResult> {
  if (!checkEmail(email)) {
    return fail('bad_email');
  }

  const passwordProblem: PasswordProblem | null = checkPassword(password);

  if (passwordProblem !== null) {
    return fail('bad_password');
  }

  const normalized = normalizeEmail(email);
  const { hash, salt } = await hashPassword(password);

  try {
    return await withTransaction(async (client) => {
      // Spend the invite first: if it is gone, nobody is created.
      const inviteResult = await client.query(
        'UPDATE invites SET used_at = now() WHERE token = $1 AND used_at IS NULL RETURNING token',
        [inviteToken],
      );

      if (inviteResult.rowCount === 0) {
        throw new InviteError();
      }

      const insert = await client.query(
        `INSERT INTO players (email, password_hash, password_salt)
         VALUES ($1, $2, $3)
         RETURNING id, email, hero_type_id, charisma`,
        [normalized, hash, salt],
      );

      const created = insert.rows[0];

      await client.query('UPDATE invites SET used_by = $1 WHERE token = $2', [
        created.id,
        inviteToken,
      ]);

      return {
        ok: true,
        player: {
          id: created.id,
          email: created.email,
          heroTypeId: created.hero_type_id,
          charisma: created.charisma,
        },
      };
    });
  } catch (error) {
    if (error instanceof InviteError) {
      return fail('invite_used');
    }

    // Postgres unique violation: this email already has an account.
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      return fail('email_taken');
    }

    throw error;
  }
}

/** Marker for "the invite was already spent" inside the transaction. */
class InviteError extends Error {}

/** Checks the email and password and returns the player. */
export async function login(email: string, password: string): Promise<AuthResult> {
  if (!checkEmail(email) || typeof password !== 'string') {
    return fail('wrong_credentials');
  }

  const row = await queryOne<PlayerRow>('SELECT * FROM players WHERE email = $1', [
    normalizeEmail(email),
  ]);

  if (row === null) {
    return fail('wrong_credentials');
  }

  const matches = await verifyPassword(password, row.password_hash, row.password_salt);

  if (!matches) {
    return fail('wrong_credentials');
  }

  return { ok: true, player: toPublic(row) };
}

/** Finds a player by id, or null. */
export async function findPlayerById(id: number): Promise<PublicPlayer | null> {
  const row = await queryOne<PlayerRow>('SELECT * FROM players WHERE id = $1', [id]);

  return row === null ? null : toPublic(row);
}
