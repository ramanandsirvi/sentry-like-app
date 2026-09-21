import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Navigation } from "./navigation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Tracebox",
    template: "%s · Tracebox",
  },
  description: "A small, explainable error ingestion and grouping system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <div className="app-frame">
          <aside className="sidebar">
            <Link href="/inbox" className="brand">
              <span className="brand-mark">T</span>
              <span>
                <strong>Tracebox</strong>
                <small>Error intelligence</small>
              </span>
            </Link>
            <Navigation />
            <div className="project-card">
              <span>Project</span>
              <strong>
                <i /> Web application
              </strong>
              <small>development</small>
            </div>
          </aside>
          <main className="app-content">{children}</main>
        </div>
      </body>
    </html>
  );
}
