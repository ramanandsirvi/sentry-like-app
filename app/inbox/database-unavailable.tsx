export function DatabaseUnavailable() {
  return (
    <section className="database-unavailable panel">
      <span className="database-icon">DB</span>
      <div>
        <p className="eyebrow">PostgreSQL unavailable</p>
        <h2>Start the local database</h2>
        <p>
          The interface is ready, but the inbox needs the Dockerized PostgreSQL
          service and its migration.
        </p>
        <pre>
          <code>
            npm run db:up{"\n"}npm run db:migrate{"\n"}npm run dev
          </code>
        </pre>
      </div>
    </section>
  );
}
