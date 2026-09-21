"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="not-found page-shell" role="alert">
      <span>500</span>
      <p className="eyebrow">Unexpected error</p>
      <h1>This view could not be loaded.</h1>
      <p>
        The error was contained by the application boundary. Check that the
        database is available, then try the request again.
      </p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
