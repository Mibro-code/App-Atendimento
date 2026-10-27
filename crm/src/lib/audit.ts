import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "LOGIN_SUCCESS"
  | "CUSTOMER_CREATED"
  | "CENTRAL_CONTACT_LINKED"
  | "CUSTOMERS_IMPORTED"
  | "CUSTOMER_UPDATED"
  | "CUSTOMER_DELETED"
  | "CUSTOMER_STATUS_CHANGED"
  | "CUSTOMER_TEMPERATURE_CHANGED"
  | "CUSTOMER_SELLER_CHANGED"
  | "ACTIVITY_CREATED"
  | "QUOTE_CREATED"
  | "SALE_CONFIRMED"
  | "SALE_CANCELLED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_PERMISSIONS_UPDATED"
  | "USER_PASSWORD_RESET"
  | "USER_PASSWORD_CHANGED"
  | "USER_DEACTIVATED"
  | "USER_REACTIVATED"
  | "USER_DELETED"
  | "PASSKEY_REGISTERED"
  | "SELLER_PROFILE_UPDATED"
  | "TEAM_SETTINGS_UPDATED"
  | "TIME_CLOCK_RECORDED"
  | "TIME_CLOCK_CORRECTED"
  | "TIME_CLOCK_OCCURRENCE_CREATED"
  | "TIME_CLOCK_OCCURRENCE_REVIEWED"
  | "FOLLOWUP_COMPLETED"
  | "FOLLOWUP_POSTPONED"
  | "QUOTE_SESSION_CREATED"
  | "QUOTE_SESSION_RESOLVED"
  | "QUOTE_SYNCED_FROM_SHOPIFY"
  | "PROPOSAL_SENT"
  | "PROPOSAL_CONVERTED"
  | "PROPOSAL_LOCATION_CAPTURED"
  | "GOAL_CREATED"
  | "GOAL_UPDATED"
  | "ORDER_FOLLOWUP_NOTIFIED"
  | "ORDER_FOLLOWUP_RESOLVED"
  | "OLIST_ORDER_STATUS_SYNCED"
  | "OLIST_ORDER_APPROVED"
  | "COMMISSION_PLAN_UPDATED"
  | "CUSTOMER_STAGE_CHANGED"
  | "CUSTOMER_RETURN_SCHEDULED"
  | "CONTACT_ATTEMPT_REGISTERED"
  | "SALE_REGISTERED_MANUALLY"
  | "SALE_COMMISSION_UPDATED"
  | "COMMISSION_TYPE_DEFAULT_UPDATED"
  | "REPRESENTATIVE_PROFILE_UPDATED"
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_UPDATED"
  | "APPOINTMENT_RESCHEDULED"
  | "APPOINTMENT_REASSIGNED"
  | "APPOINTMENT_COMPLETED"
  | "APPOINTMENT_REOPENED"
  | "APPOINTMENT_CANCELLED"
  | "PRICE_TABLE_SEEDED"
  | "PRICE_TABLE_DRAFT_CREATED"
  | "PRICE_TABLE_PUBLISHED"
  | "PRICE_TABLE_ARCHIVED"
  | "PRICE_MISMATCH_DETECTED"
  | "PRODUCT_UPDATED"
  | "QUOTE_CALCULATED"
  | "QUOTE_REPRICED"
  | "OLIST_ORDER_CALCULATED"
  | "OLIST_ORDER_SENT_FOR_REVIEW"
  | "OLIST_SYNC_FAILED";

interface LogAuditInput {
  actorId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Ponto único de gravação de AuditLog. Toda rota que altera dados sensíveis
 * (login, clientes, status/temperatura, atividades, cotações, vendas,
 * usuários) deve chamar esta função em vez de escrever em AuditLog
 * diretamente, para manter o formato consistente.
 */
export async function logAudit(input: LogAuditInput) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
