/**
 * Creates a CIDCO officer, or turns an existing account into one.
 *
 *   npm run officer:create -- officer@cidco.gov.in "R. K. Patil" <password>
 *
 * Officers are made here rather than through the portal because an officer
 * reads every company's data and approves submissions. Public sign-up creates
 * architects only; being able to run this on the server is the thing that
 * makes someone an officer.
 *
 * Run it on an existing email and it promotes that account, keeping the
 * password unless a new one is given — which is how an architect account
 * created by mistake becomes the officer it was meant to be.
 */
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';

function usage(problem?: string): never {
  if (problem) console.error(`\n${problem}\n`);
  console.error('Usage: npm run officer:create -- <email> "<full name>" [password]');
  console.error('  password may be omitted only when promoting an existing account.\n');
  process.exit(1);
}

async function main() {
  const [emailArg, nameArg, passwordArg] = process.argv.slice(2);
  if (!emailArg) usage('An email address is required.');

  const email = emailArg.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage(`"${emailArg}" is not an email address.`);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (!existing) {
    if (!nameArg) usage('A full name is required when creating a new account.');
    if (!passwordArg) usage('A password is required when creating a new account.');
    if (passwordArg.length < 8) usage('The password must be at least 8 characters.');

    const created = await prisma.user.create({
      data: {
        email,
        name: nameArg,
        role: 'CIDCO_OFFICER',
        passwordHash: await hashPassword(passwordArg),
      },
    });
    console.log(`Created CIDCO officer: ${created.email}`);
    console.log('Sign in at /cidco with that email and the password you chose.');
    return;
  }

  if (passwordArg && passwordArg.length < 8) usage('The password must be at least 8 characters.');

  const updated = await prisma.user.update({
    where: { email },
    data: {
      role: 'CIDCO_OFFICER',
      ...(nameArg ? { name: nameArg } : {}),
      ...(passwordArg ? { passwordHash: await hashPassword(passwordArg) } : {}),
    },
  });

  const was = existing.role === 'CIDCO_OFFICER' ? 'already an officer' : `was ${existing.role}`;
  console.log(`${updated.email} is now a CIDCO officer (${was}).`);
  if (!passwordArg) console.log('Password unchanged — sign in with the one you already had.');
  console.log('Sign in at /cidco. An existing browser session must be signed out first:');
  console.log('the cookie carries the old role until it is replaced.');
}

main()
  .catch((error) => {
    console.error('Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
