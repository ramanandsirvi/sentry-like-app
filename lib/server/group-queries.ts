import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { errorEvents, errorGroups } from "@/db/schema";

export type InboxTypeFilter = "all" | "console_error" | "network_error";

export async function getInboxGroups(type: InboxTypeFilter = "all") {
  return db
    .select()
    .from(errorGroups)
    .where(
      type === "all"
        ? eq(errorGroups.status, "open")
        : and(eq(errorGroups.status, "open"), eq(errorGroups.type, type)),
    )
    .orderBy(desc(errorGroups.lastSeenAt))
    .limit(100);
}

export async function getGroupDetail(groupId: string) {
  const [group] = await db
    .select()
    .from(errorGroups)
    .where(eq(errorGroups.groupId, groupId))
    .limit(1);

  if (!group) return null;

  const events = await db
    .select()
    .from(errorEvents)
    .where(eq(errorEvents.groupId, groupId))
    .orderBy(desc(errorEvents.occurredAt))
    .limit(100);

  return { group, events };
}
