/**
 * Creates the owner's sign-in. Public sign-up is switched off, so this is the
 * only way the first account comes into being.
 *
 *   npm run create-owner -- --email you@example.com
 *   npm run create-owner -- --email you@example.com --business "Your Business Ltd" --name "Your Name"
 *
 * The password is asked for privately (or read from OWNER_PASSWORD for
 * automation). It is never printed or stored anywhere but Supabase Auth.
 * Without --business, the owner sets up the business on first sign-in.
 */

import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { anonClient, serviceClient } from "./lib/client";
import { loadEnvFiles } from "./lib/env";

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
    process.stdout.write(question);
  });
}

async function main() {
  loadEnvFiles();
  const email = (arg("email") ?? process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Give the owner's email address, for example:  npm run create-owner -- --email you@example.com");

  let password = process.env.OWNER_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) fail("No password supplied. Set OWNER_PASSWORD, or run this in a terminal to be asked for one.");
    password = await askHidden("Choose a password (at least 10 characters): ");
    const again = await askHidden("Type it again: ");
    if (password !== again) fail("The two passwords did not match. Nothing was created.");
  }
  if (password.length < 10) fail("The password must be at least 10 characters. Nothing was created.");

  const { client: db } = serviceClient();
  const { data: users, error: listError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) fail(`Could not check for an existing account: ${listError.message}`);
  if (users.users.some((u) => u.email?.toLowerCase() === email)) {
    fail(`There is already an account for ${email}. If the password is forgotten, use "Forgot your password?" on the sign-in page.`);
  }

  const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !created.user) fail(`The account could not be created: ${error?.message ?? "unknown error"}`);
  console.log(`\n✓ Account created for ${email}.`);

  const business = arg("business")?.trim();
  if (business) {
    const client = anonClient();
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) fail(`The account exists, but the business could not be set up: ${signIn.error.message}. Sign in and finish setup on screen.`);
    const boot = await client.rpc("bootstrap_account", { p_business_name: business, p_full_name: arg("name")?.trim() ?? "" });
    if (boot.error) fail(`The account exists, but the business could not be set up: ${boot.error.message}. Sign in and finish setup on screen.`);
    console.log(`✓ Business "${business}" set up with ${email} as the owner.`);
  } else {
    console.log("  On first sign-in you will be asked for your business name.");
  }
  console.log("");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
