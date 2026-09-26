import "server-only";
import bcrypt from "bcryptjs";

const COST = 12;
// Pre-computed hash used to equalise timing when the account does not exist.
const DUMMY_HASH = "$2b$12$XHeyAQQhmR.tzWPLFzBCe.MlVEcEjmhq8BRhrUU0GBXSHQUpVGKCK";

export function hashPassword(password: string) {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string | null | undefined) {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}
