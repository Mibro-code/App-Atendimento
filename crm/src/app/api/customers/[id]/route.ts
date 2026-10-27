import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, notFound, fieldErrorsFromZod, validationFailed } from "@/lib/api-auth";
import { canAccessCustomer } from "@/lib/authz";
import { onlyDigits, normalizeEmail } from "@/lib/format";
import { logAudit } from "@/lib/audit";
import { transferCustomer } from "@/lib/customer-transfer";
import {
  optionalString, optionalEmail, optionalCpf, optionalCnpj, optionalPhone, optionalEnum,
} from "@/lib/customer-validation";

// Mesma regra do cadastro (POST /api/customers): nome nunca vira "" aqui
// (omitido = não alterar), demais campos opcionais aceitam "" sem erro de
// formato — ver src/lib/customer-validation.ts.
const updateSchema = z.object({
  contactName: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().min(1, "Informe o nome do cliente.").optional()
  ),
  legalName: optionalString(),
  tradeName: optionalString(),
  cnpjDigits: optionalCnpj(),
  cpfDigits: optionalCpf(),
  email: optionalEmail(),
  phoneDigits: optionalPhone(),
  phone2Digits: optionalPhone(),
  phone3Digits: optionalPhone(),
  phoneChannel: optionalEnum(["PHONE", "WHATSAPP", "WHATSAPP_BUSINESS"], "Uso do número inválido."),
  phone2Channel: optionalEnum(["PHONE", "WHATSAPP", "WHATSAPP_BUSINESS"], "Uso do número inválido."),
  phone3Channel: optionalEnum(["PHONE", "WHATSAPP", "WHATSAPP_BUSINESS"], "Uso do número inválido."),
  addressStreet: optionalString(),
  addressNumber: optionalString(),
  addressDistrict: optionalString(),
  addressComplement: optionalString(),
  city: optionalString(),
  state: optionalString(),
  spRegion: optionalString(100),
  zipDigits: optionalString(),
  leadOrigin: optionalString(),
  businessType: optionalEnum(
    ["LOJA_VIRTUAL", "LOJA_FISICA", "LOJA_FISICA_E_VIRTUAL", "OUTRO"],
    "Selecione um tipo de negócio válido."
  ),
  industrySegment: optionalString(200),
  worksWithSmartwatch: z.boolean().optional().nullable(),
  interests: z.array(z.enum(["SMARTWATCH", "OCULOS_IA", "FONE_DE_OUVIDO"])).max(3).optional(),
  interestedBrand: optionalEnum(["MIBRO", "SINCROFIT", "AMBAS"], "Selecione uma empresa de interesse válida."),
  leadCapturedAt: z.string().datetime().optional().nullable(),
  notes: optionalString(),
  sellerId: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      seller: { select: { id: true, name: true } },
      statusHistory: { orderBy: { createdAt: "desc" }, include: { changedBy: { select: { name: true } } } },
      activities: { orderBy: { createdAt: "desc" }, include: { seller: { select: { name: true } } } },
      followUps: { orderBy: { dueAt: "asc" } },
      quotes: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      sales: { orderBy: { createdAt: "desc" } },
      transferHistory: {
        orderBy: { createdAt: "desc" },
        include: {
          fromSeller: { select: { id: true, name: true } },
          toSeller: { select: { id: true, name: true } },
          transferredBy: { select: { id: true, name: true } },
        },
      },
      tags: true,
    },
  });

  if (!customer) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, customer.sellerId))) return forbidden();

  return NextResponse.json({ customer });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) return notFound("Cliente não encontrado.");
  if (!(await canAccessCustomer(user, existing.sellerId))) return forbidden();

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return validationFailed(fieldErrorsFromZod(parsed.error));
  const data = parsed.data;
  const effectiveState = data.state === undefined
    ? existing.state
    : data.state?.trim().toUpperCase() || null;
  if (data.spRegion && effectiveState !== "SP") {
    return badRequest("A região de SP só pode ser informada para clientes do estado SP.");
  }

  let transferred = false;
  if (data.sellerId && data.sellerId !== existing.sellerId) {
    const result = await transferCustomer({ actor: user, customerId: id, targetSellerId: data.sellerId });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
    transferred = true;
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      ...(data.contactName ? { contactName: data.contactName } : {}),
      ...(data.legalName !== undefined ? { legalName: data.legalName || null } : {}),
      ...(data.tradeName !== undefined ? { tradeName: data.tradeName || null } : {}),
      ...(data.cnpjDigits !== undefined ? { cnpjDigits: onlyDigits(data.cnpjDigits) || null } : {}),
      ...(data.cpfDigits !== undefined ? { cpfDigits: onlyDigits(data.cpfDigits) || null } : {}),
      ...(data.email !== undefined ? { email: data.email ? normalizeEmail(data.email) : null } : {}),
      ...(data.phoneDigits !== undefined ? { phoneDigits: onlyDigits(data.phoneDigits) || null } : {}),
      ...(data.phone2Digits !== undefined ? { phone2Digits: data.phone2Digits || null } : {}),
      ...(data.phone3Digits !== undefined ? { phone3Digits: data.phone3Digits || null } : {}),
      ...(data.phoneChannel !== undefined ? { phoneChannel: data.phoneChannel } : {}),
      ...(data.phone2Channel !== undefined ? { phone2Channel: data.phone2Channel } : {}),
      ...(data.phone3Channel !== undefined ? { phone3Channel: data.phone3Channel } : {}),
      ...(data.phoneDigits === null ? { phoneChannel: null } : {}),
      ...(data.phone2Digits === null ? { phone2Channel: null } : {}),
      ...(data.phone3Digits === null ? { phone3Channel: null } : {}),
      ...(data.addressStreet !== undefined ? { addressStreet: data.addressStreet || null } : {}),
      ...(data.addressNumber !== undefined ? { addressNumber: data.addressNumber || null } : {}),
      ...(data.addressDistrict !== undefined ? { addressDistrict: data.addressDistrict || null } : {}),
      ...(data.addressComplement !== undefined ? { addressComplement: data.addressComplement || null } : {}),
      ...(data.city !== undefined ? { city: data.city || null } : {}),
      ...(data.state !== undefined ? { state: effectiveState } : {}),
      ...(data.spRegion !== undefined ? { spRegion: data.spRegion?.trim() || null } : {}),
      ...(data.state !== undefined && effectiveState !== "SP" ? { spRegion: null } : {}),
      ...(data.zipDigits !== undefined ? { zipDigits: onlyDigits(data.zipDigits) || null } : {}),
      ...(data.leadOrigin !== undefined ? { leadOrigin: data.leadOrigin || null } : {}),
      ...(data.businessType !== undefined ? { businessType: data.businessType || null } : {}),
      ...(data.industrySegment !== undefined ? { industrySegment: data.industrySegment || null } : {}),
      ...(data.worksWithSmartwatch !== undefined ? { worksWithSmartwatch: data.worksWithSmartwatch } : {}),
      ...(data.interests !== undefined ? { interests: data.interests } : {}),
      ...(data.interestedBrand !== undefined ? { interestedBrand: data.interestedBrand || null } : {}),
      ...(data.leadCapturedAt !== undefined ? { leadCapturedAt: data.leadCapturedAt ? new Date(data.leadCapturedAt) : null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
    },
  });

  await logAudit({
    actorId: user.id,
    action: "CUSTOMER_UPDATED",
    entityType: "Customer",
    entityId: customer.id,
    metadata: transferred ? { fieldsUpdatedAfterTransfer: true } : undefined,
  });

  return NextResponse.json({ customer });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { user, error } = await requireSession();
  if (error) return error;

  // "Master" no CRM corresponde ao papel ADMIN. A verificacao fica na API,
  // e nao apenas no botao da interface, para impedir exclusao por chamada
  // direta feita por vendedor ou supervisor.
  if (user.role !== "ADMIN") {
    return forbidden("Apenas administradores podem excluir clientes.");
  }

  const existing = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      contactName: true,
      tradeName: true,
      sellerId: true,
      _count: {
        select: {
          activities: true,
          followUps: true,
          quotes: true,
          sales: true,
          olistOrders: true,
        },
      },
    },
  });
  if (!existing) return notFound("Cliente não encontrado.");

  await prisma.$transaction(async (tx) => {
    // Alguns relacionamentos historicos nao usam onDelete: Cascade. A ordem
    // abaixo remove primeiro os registros dependentes para manter a operacao
    // atomica e evitar dados orfaos.
    await tx.locationCapture.deleteMany({
      where: {
        OR: [
          { customerId: id },
          { quote: { customerId: id } },
          { activity: { customerId: id } },
        ],
      },
    });
    await tx.crmSessionToken.deleteMany({ where: { customerId: id } });
    await tx.sale.deleteMany({ where: { customerId: id } });
    await tx.olistOrder.deleteMany({ where: { customerId: id } });
    await tx.quote.deleteMany({ where: { customerId: id } });
    await tx.followUp.deleteMany({ where: { customerId: id } });
    await tx.customerActivity.deleteMany({ where: { customerId: id } });
    await tx.customerStatusHistory.deleteMany({ where: { customerId: id } });
    await tx.customer.delete({ where: { id } });
  });

  await logAudit({
    actorId: user.id,
    action: "CUSTOMER_DELETED",
    entityType: "Customer",
    entityId: existing.id,
    metadata: {
      contactName: existing.contactName,
      tradeName: existing.tradeName,
      sellerId: existing.sellerId,
      deletedRelations: existing._count,
    },
  });

  return NextResponse.json({ success: true });
}
