import { db, uid } from "./db";
import type { User } from "./types";

export async function logAudit(
  user: Pick<User, "id" | "name">,
  action: string,
  entity: string,
  entityId: string,
  summary: string,
) {
  await db.audit.add({
    id: uid(),
    at: Date.now(),
    userId: user.id,
    userName: user.name,
    action,
    entity,
    entityId,
    summary,
  });
}
