import { prisma } from './prisma';

/**
 * Best-effort audit trail. A logging failure must never fail the user's action,
 * so errors here are swallowed after being reported to the console.
 */
export async function logActivity(input: {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | number | null;
  detail?: string | null;
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        actor: input.actor,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId != null ? String(input.entityId) : null,
        detail: input.detail ?? null,
      },
    });
  } catch (error) {
    console.warn('[activity] could not write log entry:', error);
  }
}
