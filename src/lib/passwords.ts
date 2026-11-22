/**
 * Password rules and hashing shared by sign-up, sign-in and (from package 1.5) recovery and
 * password change.
 */
import "server-only";

import bcrypt from "bcryptjs";
import { z } from "zod";

/** bcrypt work factor for new hashes. Existing hashes keep the cost they were made with. */
export const BCRYPT_COST = 12;

/**
 * A fixed bcrypt hash (cost 12) of a random string nobody knows. Sign-in compares against it when
 * the username does not exist, so a wrong username takes as long as a wrong password and the
 * response time does not reveal which usernames are registered.
 */
const DUMMY_HASH = "$2b$12$5Ht/uyiFX/67h5hcl/m/U.v9xXxELIZDsH3GkiwKUibiINODeHrVC";

/** Rules for a NEW password: 8–72 characters. Sign-in still accepts older, shorter passwords. */
export const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be 72 characters or fewer.");

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Checks a password against a stored hash, or against the dummy hash when there is no account. */
export async function verifyPassword(password: string, storedHash: string | null) {
  const matches = await bcrypt.compare(password, storedHash ?? DUMMY_HASH);
  return storedHash !== null && matches;
}
