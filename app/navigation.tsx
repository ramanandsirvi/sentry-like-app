"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/inbox", label: "Error inbox", icon: "⌁" },
  { href: "/simulator", label: "Simulator", icon: "⌘" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="main-nav" aria-label="Main navigation">
      {navigation.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "nav-link active" : "nav-link"}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
