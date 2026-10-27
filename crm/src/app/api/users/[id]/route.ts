import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {hasPrimaryCredentials} from '@/lib/primary-password';
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { canAdminDeleteUser } from "@/lib/team-rules";
import { normalizeRca } from "@/lib/rca";
import { isUniqueViolation } from "@/lib/rca-server";

// Campos de identidade/autenticação (User) e campos comerciais
// (SellerProfile) chegam juntos no mesmo PATCH (mesma tela de edição no
// admin), mas são gravados em modelos diferentes.
const updateSchema = z.object({
  name: z.string().min(2).optional(),
  rca: z.string().min(1).max(12).optional(),
  role: z.enum(["ADMIN", "SUPERVISOR", "VENDEDOR", "REPRESENTANTE"]).optional(),
  supervisorId: z.string().optional().nullable(),
  active: z.boolean().optional(),
  newPassword: z.string().min(8).optional(),
  followUpAfterDays: z.number().int().min(1).max(365).optional(),
  allowSellerCustomerTransfer: z.boolean().optional(),
  canTransferOwnCustomers: z.boolean().optional(),
  canCreateTeamUsers: z.boolean().optional(),
  timeClockReminderEnabled:z.boolean().optional(),
  timeClockRequiredEvents:z.array(z.enum(["CLOCK_IN","LUNCH_START","LUNCH_END","CLOCK_OUT"])).max(4).optional(),
  timeClockWorkingDays:z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  timeClockStartMinutes:z.number().int().min(0).max(1439).optional(),
  timeClockLunchStartMinutes:z.number().int().min(0).max(1439).optional(),
  timeClockLunchEndMinutes:z.number().int().min(0).max(1439).optional(),
  timeClockEndMinutes:z.number().int().min(0).max(1439).optional(),
  timeClockReminderIntervalMinutes:z.number().int().min(5).max(180).optional(),

  // SellerProfile
  displayName: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  monthlyGoalCents: z.number().int().nonnegative().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  representativeType: z.enum(["ATACADO", "VAREJO", "OUTRO"]).optional().nullable(),
});

const SELLER_PROFILE_KEYS = new Set([
  "displayName",
  "phone",
  "whatsapp",
  "jobTitle",
  "region",
  "monthlyGoalCents",
  "internalNotes",
  "representativeType",
]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Apenas administradores podem ver detalhes de usuários.");

  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      rca: true,
      role: true,
      active: true,
      supervisorId: true,
      followUpAfterDays: true,
      allowSellerCustomerTransfer: true,
      canTransferOwnCustomers: true,
      canCreateTeamUsers: true,
      timeClockReminderEnabled:true,timeClockRequiredEvents:true,timeClockWorkingDays:true,
      timeClockStartMinutes:true,timeClockLunchStartMinutes:true,timeClockLunchEndMinutes:true,
      timeClockEndMinutes:true,timeClockReminderIntervalMinutes:true,
      createdAt: true,
      lastLoginAt: true,
      sellerProfile: {
        select: {
          displayName: true,
          phone: true,
          whatsapp: true,
          jobTitle: true,
          region: true,
          monthlyGoalCents: true,
          internalNotes: true,
          representativeType: true,
        },
      },
      representativeRegions: { select: { state: true, city: true }, orderBy: [{ state: "asc" }, { city: "asc" }] },
    },
  });
  if (!target) return notFound("Usuário não encontrado.");
  return NextResponse.json({ user: target });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Apenas administradores podem editar usuários.");

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return notFound("Usuário não encontrado.");
  if (existing.deletedAt) return badRequest("Esta conta foi excluída e não pode mais ser alterada.");

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;
  if(data.newPassword && await hasPrimaryCredentials(id,existing.role))return badRequest('Esta conta usa a senha do Atendimento. Faça a redefinição na Central de Atendimento.');
  const effectiveRole = data.role ?? existing.role;
  const effectiveSupervisorId = data.supervisorId !== undefined ? data.supervisorId : existing.supervisorId;
  const schedule=[data.timeClockStartMinutes??existing.timeClockStartMinutes,data.timeClockLunchStartMinutes??existing.timeClockLunchStartMinutes,data.timeClockLunchEndMinutes??existing.timeClockLunchEndMinutes,data.timeClockEndMinutes??existing.timeClockEndMinutes];
  if(!(schedule[0]<=schedule[1]&&schedule[1]<=schedule[2]&&schedule[2]<=schedule[3]))return badRequest("Os horários do ponto devem seguir a ordem entrada, almoço, retorno e saída.");
  if (effectiveRole === "REPRESENTANTE" && effectiveSupervisorId) {
    const supervisor = await prisma.user.findFirst({
      where: { id: effectiveSupervisorId, role: "SUPERVISOR", active: true },
      select: { id: true },
    });
    if (!supervisor) return badRequest("O representante deve ser vinculado a um supervisor ativo.");
  }

  const userUpdateData: Record<string, unknown> = {};
  if (data.name !== undefined) userUpdateData.name = data.name;
  if (data.rca !== undefined) {
    const rca = normalizeRca(data.rca);
    if (!rca) return badRequest("RCA inválido. Use somente números (ex.: 027).");
    if (rca !== existing.rca) {
      const taken = await prisma.user.findUnique({ where: { rca }, select: { id: true } });
      if (taken && taken.id !== id) return NextResponse.json({ error: `O RCA ${rca} já pertence a outro usuário.` }, { status: 409 });
      userUpdateData.rca = rca;
    }
  }
  if (data.role !== undefined) userUpdateData.role = data.role;
  if (data.supervisorId !== undefined) userUpdateData.supervisorId = data.supervisorId || null;
  if (data.active !== undefined) userUpdateData.active = data.active;
  if (data.followUpAfterDays !== undefined) userUpdateData.followUpAfterDays = data.followUpAfterDays;
  if (data.allowSellerCustomerTransfer !== undefined) {
    userUpdateData.allowSellerCustomerTransfer = data.allowSellerCustomerTransfer;
  }
  if (data.canTransferOwnCustomers !== undefined) {
    userUpdateData.canTransferOwnCustomers = data.canTransferOwnCustomers;
  }
  if (data.canCreateTeamUsers !== undefined) {
    userUpdateData.canCreateTeamUsers = data.canCreateTeamUsers;
  }
  for(const field of ["timeClockReminderEnabled","timeClockRequiredEvents","timeClockWorkingDays","timeClockStartMinutes","timeClockLunchStartMinutes","timeClockLunchEndMinutes","timeClockEndMinutes","timeClockReminderIntervalMinutes"] as const){if(data[field]!==undefined)userUpdateData[field]=data[field];}
  if (data.newPassword) userUpdateData.passwordHash = await bcrypt.hash(data.newPassword, 12);

  const profileUpdateData: Record<string, unknown> = {};
  if (data.displayName !== undefined) profileUpdateData.displayName = data.displayName;
  if (data.phone !== undefined) profileUpdateData.phone = data.phone || null;
  if (data.whatsapp !== undefined) profileUpdateData.whatsapp = data.whatsapp || null;
  if (data.jobTitle !== undefined) profileUpdateData.jobTitle = data.jobTitle || null;
  if (data.region !== undefined) profileUpdateData.region = data.region || null;
  if (data.monthlyGoalCents !== undefined) profileUpdateData.monthlyGoalCents = data.monthlyGoalCents;
  if (effectiveRole === "REPRESENTANTE") profileUpdateData.monthlyGoalCents = null;
  if (data.internalNotes !== undefined) profileUpdateData.internalNotes = data.internalNotes || null;
  if (data.representativeType !== undefined) profileUpdateData.representativeType = effectiveRole === "REPRESENTANTE" ? data.representativeType : null;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id },
      data: userUpdateData,
      select: { id: true, name: true, email: true, role: true, active: true },
    });

    if (Object.keys(profileUpdateData).length > 0) {
      // Upsert: o usuário pode ainda não ter SellerProfile (ex.: um ADMIN
      // puramente administrativo recebendo cargo/telefone pela primeira
      // vez). displayName é obrigatório no model — se estiver sendo criado
      // agora e não veio no payload, usa o nome do User como fallback.
      await tx.sellerProfile.upsert({
        where: { userId: id },
        update: profileUpdateData,
        create: {
          userId: id,
          displayName: (profileUpdateData.displayName as string | undefined) ?? updatedUser.name,
          ...profileUpdateData,
        },
      });
    }

    if (effectiveRole === "REPRESENTANTE") {
      await tx.salesGoal.updateMany({
        where: { sellerId: id, status: "ACTIVE" },
        data: { status: "CANCELLED" },
      });
    }

    return updatedUser;
  }).catch((updateError) => {
    if (isUniqueViolation(updateError, "rca")) return null;
    throw updateError;
  });
  if (!updated) return NextResponse.json({ error: "Este RCA acabou de ser usado por outro usuário." }, { status: 409 });

  if (data.newPassword) {
    await logAudit({ actorId: user.id, action: "USER_PASSWORD_RESET", entityType: "User", entityId: id });
  }
  if (data.active === false) {
    await logAudit({ actorId: user.id, action: "USER_DEACTIVATED", entityType: "User", entityId: id });
  } else if (data.active === true) {
    await logAudit({ actorId: user.id, action: "USER_REACTIVATED", entityType: "User", entityId: id });
  }

  const userFieldChanges = Object.keys(userUpdateData).filter((k) => k !== "passwordHash" && k !== "active");
  if (userFieldChanges.length > 0) {
    await logAudit({
      actorId: user.id,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: id,
      metadata: {
        changes: Object.fromEntries(userFieldChanges.map((field) => [field, {
          from: existing[field as keyof typeof existing] ?? null,
          to: userUpdateData[field] ?? null,
        }])),
      },
    });
  }

  const profileFieldChanges = Object.keys(profileUpdateData).filter((k) => SELLER_PROFILE_KEYS.has(k));
  if (profileFieldChanges.length > 0) {
    await logAudit({
      actorId: user.id,
      action: "SELLER_PROFILE_UPDATED",
      entityType: "SellerProfile",
      entityId: id,
      metadata: { fields: profileFieldChanges },
    });
  }

  return NextResponse.json({ user: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Apenas administradores podem excluir contas.");

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true, deletedAt: true, _count: { select: { team: true } } },
  });
  if (!target) return notFound("Usuário não encontrado.");
  if (target.deletedAt) return badRequest("Esta conta já foi excluída.");
  if (!canAdminDeleteUser(user, id, target._count.team)) {
    return badRequest(user.id === id ? "Você não pode excluir a própria conta." : "Reatribua os integrantes desta equipe antes de excluir o supervisor.");
  }

  const deletedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.passkeyCredential.deleteMany({ where: { userId: id } });
    await tx.user.update({
      where: { id },
      data: {
        active: false,
        deletedAt,
        webAuthnChallenge: null,
        webAuthnChallengePurpose: null,
        webAuthnChallengeExpiresAt: null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "USER_DELETED",
        entityType: "User",
        entityId: id,
        metadata: { name: target.name, email: target.email, role: target.role, deletedAt: deletedAt.toISOString() },
      },
    });
  });

  return NextResponse.json({ success: true });
}
