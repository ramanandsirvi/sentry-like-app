"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <button className="refresh-button" onClick={refresh} disabled={isPending}>
      <span className={isPending ? "refresh-icon spinning" : "refresh-icon"}>
        ↻
      </span>
      {isPending ? "Refreshing" : "Updates every 3s"}
    </button>
  );
}
