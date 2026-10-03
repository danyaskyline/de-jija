/**
 * Password hashing with scrypt, built into Node - no extra dependency.
 *
 * Why this way (ADR 027):
 *  - the password itself is NEVER stored or logged, only a hash plus a salt;
 *  - scrypt is deliberately slow, which is the whole point: it makes guessing
 *    a stolen hash expensive;
 *  - each account gets its own random salt, so two users with the same password
 *    still have different hashes;
 *  - the parameters live here in code, not in config: they are a security
 *    decision, not a balance number.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

/** Hash length in bytes. 64 gives a comfortable margin for scrypt. */
const KEY_LENGTH = 64;

/** Salt length in bytes. 16 is the usual minimum and is plenty here. */
const SALT_LENGTH = 16;

/** Hashes a password with a fresh random salt. Returns both, to store them. */
export async function hashPassword(password: string): Promise<{
  hash: string;
  salt: string;
}> {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH);

  return { hash: derived.toString('hex'), salt };
}

/**
 * Checks a password against a stored hash.
 *
 * Compares with a constant-time comparison, so an attacker cannot learn the
 * correct hash by measuring how long the comparison takes.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string,
): Promise<boolean> {
  const derived = await scrypt(password, storedSalt, KEY_LENGTH);
  const expected = Buffer.from(storedHash, 'hex');

  if (expected.length !== derived.length) {
    return false;
  }

  return timingSafeEqual(expected, derived);
}

/** Why a password was refused, so the route can answer the player. */
export type PasswordProblem =
  | 'too_short'
  | 'too_long'
  | 'not_a_string';

/** Password rules for the arena: long enough to be safe, not absurd. */
export function checkPassword(password: unknown): PasswordProblem | null {
  if (typeof password !== 'string') {
    return 'not_a_string';
  }

  if (password.length < 8) {
    return 'too_short';
  }

  if (password.length > 200) {
    return 'too_long';
  }

  return null;
}

/** Email rules: we do not send letters, so we only check the obvious. */
export function checkEmail(email: unknown): boolean {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Normalizes an email for storage and lookup: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
