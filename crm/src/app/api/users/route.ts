import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { canSupervisorCreateTeamUser } from "@/lib/team-rules";
import { generateNextRca, isUniqueViolation } from "@/lib/rca-server";
import { linkCentralAccount } from '@/lib/central-account-link';

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  role: z.enum(["ADMIN", "SUPERVISOR", "VENDEDOR", "REPRESENTANTE"]),
  jobTitle: z.string().optional().nullable(),
  supervisorId: z.string().optional().nullable(),
  monthlyGoalCents: z.number().int().nonnegative().optional().nullable(),
  region: z.string().optional().nullable(),
  representativeType: z.enum(["ATACADO", "VAREJO", "OUTRO"]).optional().nullable(),
  password: z.string().min(8, "Senha deve ter ao menos 8 caracteres."),
});

// A listagem é restrita a ADMIN. A criação também pode ser feita por um
// supervisor explicitamente liberado, mas somente para membros da própria
// equipe e sem aceitar papel/supervisorId do frontend como autoridade.
export async function GET() {
  const { user, error } = await requireSession();
  if (error) return error;
  if (user.role !== "ADMIN") return forbidden("Apenas administradores podem listar usuários.");

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
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
      createdAt: true,
      lastLoginAt: true,
      sellerProfile: {
        select: { phone: true, jobTitle: true, region: true, monthlyGoalCents: true, representativeType: true },
      },
      _count: { select: { customers: true } },
    },
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const supervisorPermission = user.role === "SUPERVISOR"
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, active: true, canCreateTeamUsers: true },
      })
    : null;
  const supervisorCanCreate = supervisorPermission
    ? canSupervisorCreateTeamUser(supervisorPermission, "VENDEDOR")
    : false;
  if (user.role !== "ADMIN" && !supervisorCanCreate) {
    return forbidden("Você não possui permissão para criar integrantes da equipe.");
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;
  if (user.role === "SUPERVISOR" && (!supervisorPermission || !canSupervisorCreateTeamUser(supervisorPermission, data.role))) {
    return forbidden("Supervisores podem criar somente vendedores ou representantes.");
  }
  const effectiveSupervisorId = user.role === "SUPERVISOR" ? user.id : data.supervisorId || null;

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase().trim() } });
  if (existing) return badRequest("Já existe um usuário com este e-mail.");

  if (data.role === "REPRESENTANTE" && effectiveSupervisorId) {
    const supervisor = await prisma.user.findFirst({
      where: { id: effectiveSupervisorId, role: "SUPERVISOR", active: true },
      select: { id: true },
    });
    if (!supervisor) return badRequest("O representante deve ser vinculado a um supervisor ativo.");
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  // Cria o User (identidade/autenticação) e o SellerProfile correspondente
  // (dados comerciais) juntos, numa transação, para nunca deixar um
  // vendedor/supervisor recém-criado sem perfil comercial — mesmo que os
  // campos comerciais opcionais não tenham sido preenchidos no formulário,
  // ao menos displayName é sempre gravado.
  // RCA sequencial gerado no servidor; em caso de colisão concorrente no
  // índice único, tenta de novo com o próximo número livre.
  const createUser = () => prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase().trim(),
        role: data.role,
        supervisorId: effectiveSupervisorId,
        passwordHash,
        rca: await generateNextRca(tx),
      },
      select: { id: true, name: true, email: true, role: true, rca: true },
    });

    await tx.sellerProfile.create({
      data: {
        userId: newUser.id,
        displayName: data.name,
        phone: data.phone || null,
        jobTitle: data.jobTitle || null,
        monthlyGoalCents: data.role === "REPRESENTANTE" ? null : data.monthlyGoalCents ?? null,
        region: data.region || null,
        representativeType: data.role === "REPRESENTANTE" ? data.representativeType ?? null : null,
      },
    });

    return newUser;
  });
  let created;
  for (let attempt = 0; ; attempt += 1) {
    try {
      created = await createUser();
      break;
    } catch (createError) {
      if (attempt < 3 && isUniqueViolation(createError, "rca")) continue;
      throw createError;
    }
  }

  await logAudit({
    actorId: user.id,
    action: "USER_CREATED",
    entityType: "User",
    entityId: created.id,
    metadata: { role: created.role, rca: created.rca },
  });

  // Outside the creation transaction: a bridge outage never rolls back the
  // account or encourages a duplicate creation. Retry from Attendance > Equipe.
  let centralAccess;
  try { centralAccess = await linkCentralAccount({ ...created, active: true, deletedAt: null }); }
  catch { centralAccess = { status: 'PENDING', warning: 'Conta criada. Vínculo com o Atendimento pendente; confira em Equipe > Acesso ao CRM.' }; }
  return NextResponse.json({ user: created, centralAccess }, { status: 201 });
}
