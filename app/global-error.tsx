"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>
        <h2>App crashed</h2>
        {error.digest && <p>Digest: {error.digest}</p>}
        <pre style={{ whiteSpace: "pre-wrap" }}>{String(error.message || error)}</pre>
        <button onClick={() => reset()} style={{ marginTop: 12 }}>
          Try again
        </button>
      </body>
    </html>
  );
}

