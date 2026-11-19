"use client";

/**
 * Last-resort error page. It replaces the root layout, so it cannot rely on
 * the design system's stylesheet or fonts: styles are inline and minimal.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, background: "#f6f5f1", color: "#16191d", fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div role="alert" style={{ maxWidth: "32rem", width: "100%", background: "#fff", border: "1px solid #e2dfd7", borderRadius: 12, padding: "2rem" }}>
            <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Something Went Wrong</h1>
            <p style={{ color: "#3d444d", lineHeight: 1.5 }}>
              The app could not start properly. Nothing you have saved has been lost. Please try again, and if it keeps happening tell whoever looks after the system.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ height: 44, padding: "0 1rem", borderRadius: 8, border: 0, background: "#b84700", color: "#fff", fontSize: "0.9375rem", fontWeight: 500, cursor: "pointer" }}
            >
              Try Again
            </button>
            <details style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "#3d444d" }}>
              <summary style={{ cursor: "pointer", color: "#66707c" }}>Technical Details</summary>
              <pre style={{ whiteSpace: "pre-wrap", background: "#efede7", padding: "0.75rem", borderRadius: 6, fontSize: "0.75rem", overflowX: "auto" }}>
                {[error.digest ? `Reference: ${error.digest}` : null, error.name ? `Type: ${error.name}` : null, error.message ? `Message: ${error.message}` : null].filter(Boolean).join("\n")}
              </pre>
            </details>
          </div>
        </main>
      </body>
    </html>
  );
}
