import { describe, expect, it } from "vitest";
import { classifyLoginFailure } from "@/lib/dpd/login-failure";

describe("why a DPD sign-in did not complete", () => {
  it("reports a wrong password as a login problem to fix in Settings", () => {
    const e = classifyLoginFailure("Login failed. Invalid username or password.", false);
    expect(e.kind).toBe("auth");
    expect(e.plainEnglish).toMatch(/did not accept this username and password/);
  });

  it("stops, and does not retry, when DPD asks for a password change or new terms", () => {
    for (const text of ["Your password has expired. Please change your password.", "Please accept the new terms and conditions to continue", "Your account has been locked"]) {
      const e = classifyLoginFailure(text, false);
      expect(e.kind).toBe("blocked");
      expect(e.retryable).toBe(false);
      expect(e.plainEnglish).toMatch(/sign in on the DPD portal yourself/i);
    }
  });

  it("never tries to get past a verification code or a CAPTCHA", () => {
    expect(classifyLoginFailure("Enter the code from your authenticator app", false).step).toBe("login:mfa");
    expect(classifyLoginFailure("", true).step).toBe("login:captcha");
  });

  it("falls back to a message that says what to check, with what the page said in the details", () => {
    const e = classifyLoginFailure("Welcome   back\n\nLoading…", false);
    expect(e.kind).toBe("layout");
    expect(e.plainEnglish).toMatch(/Try this username and password on the DPD portal yourself/);
    expect(e.plainEnglish).not.toMatch(/layout may have changed\.$/);
    expect(e.message).toContain("Portal said: Welcome back Loading…");
  });

  it("does not treat an ordinary page as a block", () => {
    expect(classifyLoginFailure("Dashboard Payments Invoices", false).retryable).toBe(true);
  });
});
