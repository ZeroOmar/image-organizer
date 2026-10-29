import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline/promises';

/**
 * Print a bcrypt hash for admin.passwordHash.
 *   hash-password 'secret'        (argument)
 *   echo secret | hash-password   (stdin, keeps it out of shell history)
 * In docker-compose files, escape every $ in the hash as $$.
 */
async function main() {
  let password = process.argv[2];
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
    password = (await rl.question(process.stdin.isTTY ? 'Password: ' : '')).trim();
    rl.close();
  }
  if (!password) {
    console.error('No password given');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
  console.error(`docker-compose (escaped): ${hash.replace(/\$/g, '$$$$')}`);
}

void main();
