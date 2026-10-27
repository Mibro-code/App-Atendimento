import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest } from "@/lib/api-auth";

// Vendedor comum só edita o próprio nome (User) e telefone/whatsapp
// (SellerProfile). Cargo é definido pelo admin ao criar/editar o vendedor
// (/api/users/[id]) — não é autoeditável. Role e status (active) também
// NUNCA são editáveis por aqui.
const schema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
});

export async function GET() {
  const { user, error } = await requireSession();
  if (error) return error;

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      sellerProfile: {
        select: { phone: true, whatsapp: true, jobTitle: true },
      },
    },
  });
  return NextResponse.json({ user: me });
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return badRequest("Dados inválidos.", parsed.error.flatten());
  const data = parsed.data;

  const profileData: Record<string, unknown> = {};
  if (data.phone !== undefined) profileData.phone = data.phone || null;
  if (data.whatsapp !== undefined) profileData.whatsapp = data.whatsapp || null;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: data.name !== undefined ? { name: data.name } : {},
      select: { id: true, name: true },
    });

    // Autoedição de perfil: se o usuário logado (ex.: um ADMIN sem perfil
    // comercial ainda) não tinha SellerProfile, cria sob demanda — nunca
    // deixa a aplicação quebrar por falta desse registro.
    if (Object.keys(profileData).length > 0) {
      await tx.sellerProfile.upsert({
        where: { userId: user.id },
        update: profileData,
        create: {
          userId: user.id,
          displayName: updatedUser.name,
          ...profileData,
        },
      });
    }

    return updatedUser;
  });

  const profile = await prisma.sellerProfile.findUnique({
    where: { userId: user.id },
    select: { phone: true, whatsapp: true, jobTitle: true },
  });

  return NextResponse.json({ user: { ...updated, sellerProfile: profile } });
}
