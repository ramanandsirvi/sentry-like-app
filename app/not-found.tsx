import Link from "next/link";

export default function NotFound() {
  return (
    <div className="not-found page-shell">
      <span>404</span>
      <h1>Issue not found</h1>
      <p>The error group may have been removed or the address is invalid.</p>
      <Link href="/inbox" className="primary-button">
        Return to inbox
      </Link>
    </div>
  );
}
