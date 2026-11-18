import { afterEach, describe, expect, it } from "vitest";
import { sendEmail } from "@/lib/notify/email";

const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };
afterEach(() => {
  if (saved.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.key;
  if (saved.from === undefined) delete process.env.EMAIL_FROM; else process.env.EMAIL_FROM = saved.from;
});

describe("sending email", () => {
  it("sends nothing and reports so until both the key and the sender are set", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    await expect(sendEmail({ to: "owner@example.test", subject: "Hello", text: "Hi" })).resolves.toBe(false);
    process.env.RESEND_API_KEY = "re_test_key";
    await expect(sendEmail({ to: "owner@example.test", subject: "Hello", text: "Hi" })).resolves.toBe(false);
  });
});
