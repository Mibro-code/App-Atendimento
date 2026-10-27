import { NextRequest, NextResponse } from "next/server";
import { phoneDetails } from "@/lib/customer-phones";
import { prisma } from "@/lib/prisma";
import { forbidden, requireSession } from "@/lib/api-auth";
import {
  buildCustomerListWhere,
  CustomerFilterForbiddenError,
  parseCustomerListFilters,
} from "@/lib/customer-list";
import { buildCsv } from "@/lib/csv";
import { formatCnpjOrCpf, formatDateTime, formatPhone } from "@/lib/format";
import { STATUS_LABELS, TEMPERATURE_LABELS } from "@/lib/labels";
import { syncAutomaticFollowUpsForScope } from "@/lib/automatic-followups";
import { BUSINESS_TYPE_LABELS, CUSTOMER_INTEREST_LABELS, INTERESTED_BRAND_LABELS } from "@/lib/customer-fields";
import { canExportCustomers } from "@/lib/authz";
import { PIPELINE_STAGE_META } from "@/lib/pipeline-rules";

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  // Vendedor e representante não exportam clientes (nem a própria carteira).
  if (!canExportCustomers(user.role)) {
    return forbidden("Exportação de clientes disponível apenas para supervisor e administrador.");
  }
  await syncAutomaticFollowUpsForScope(user);

  const filters = parseCustomerListFilters({
    q: req.nextUrl.searchParams.get("q"),
    sellerId: req.nextUrl.searchParams.get("sellerId"),
    status: req.nextUrl.searchParams.get("status"),
    temperature: req.nextUrl.searchParams.get("temperature"),
    state: req.nextUrl.searchParams.get("state"),
    spRegion: req.nextUrl.searchParams.get("spRegion"),
    city: req.nextUrl.searchParams.get("city"),
    leadOrigin: req.nextUrl.searchParams.get("leadOrigin"),
    createdFrom: req.nextUrl.searchParams.get("createdFrom"),
    createdTo: req.nextUrl.searchParams.get("createdTo"),
    businessType: req.nextUrl.searchParams.get("businessType"),
    industrySegment: req.nextUrl.searchParams.get("industrySegment"),
    worksWithSmartwatch: req.nextUrl.searchParams.get("worksWithSmartwatch"),
    interest: req.nextUrl.searchParams.get("interest"),
    interestedBrand: req.nextUrl.searchParams.get("interestedBrand"),
    ...Object.fromEntries(
      ["stage", "attempts", "address", "followUp", "repurchase", "representativeType", "sellerRca"].map((key) => [key, req.nextUrl.searchParams.get(key)])
    ),
  });

  let where;
  try {
    where = await buildCustomerListWhere(user, filters);
  } catch (filterError) {
    if (filterError instanceof CustomerFilterForbiddenError) {
      return forbidden("Você não pode exportar a carteira desse vendedor.");
    }
    throw filterError;
  }

  const customers = await prisma.customer.findMany({
    where,
    select: {
      contactName: true,
      tradeName: true,
      legalName: true,
      cnpjDigits: true,
      cpfDigits: true,
      phoneDigits: true,
      phone2Digits: true, phone3Digits: true, phoneChannel: true, phone2Channel: true, phone3Channel: true,
      email: true,
      addressStreet: true,
      addressNumber: true,
      addressComplement: true,
      addressDistrict: true,
      zipDigits: true,
      city: true,
      state: true,
      spRegion: true,
      pipelineStage: true,
      cycleContactAttempts: true,
      commercialCycle: true,
      stageReason: true,
      leadOrigin: true,
      businessType: true,
      industrySegment: true,
      worksWithSmartwatch: true,
      interests: true,
      interestedBrand: true,
      leadCapturedAt: true,
      status: true,
      temperature: true,
      createdAt: true,
      lastInteractionAt: true,
      seller: { select: { name: true, rca: true, sellerProfile: { select: { displayName: true } } } },
      followUps: {
        where: { status: { in: ["PENDENTE", "ADIADO"] } },
        orderBy: { dueAt: "asc" },
        take: 1,
        select: { dueAt: true },
      },
      _count: { select: { quotes: { where: { deletedAt: null } }, sales: true } },
    },
    orderBy: [{ seller: { name: "asc" } }, { tradeName: "asc" }, { contactName: "asc" }],
  });

  const csv = buildCsv(
    [
      "Nome", "Razão social", "CNPJ/CPF", "Telefone", "Telefone 2", "Telefone 3", "Tipo telefone", "Tipo telefone 2", "Tipo telefone 3", "Link WhatsApp", "Link WhatsApp 2", "Link WhatsApp 3", "E-mail", "Status", "Temperatura",
      "Etapa do funil", "Tentativas no ciclo", "Ciclo comercial", "Motivo da etapa",
      "Endereço", "Complemento", "Bairro", "CEP", "Cidade", "Estado", "Região de SP", "Origem do lead", "Tipo de negócio", "Segmento de atuação",
      "Já trabalha com Smartwatch", "Interesses", "Empresa de interesse", "Carimbo original",
      "Vendedor", "RCA do vendedor", "Data de cadastro", "Última interação", "Próximo follow-up", "Propostas", "Vendas",
    ],
    customers.map((customer) => [
      customer.tradeName || customer.contactName,
      customer.legalName,
      formatCnpjOrCpf(customer.cnpjDigits || customer.cpfDigits),
      formatPhone(customer.phoneDigits),
      formatPhone(customer.phone2Digits), formatPhone(customer.phone3Digits),
      customer.phoneChannel, customer.phone2Channel, customer.phone3Channel,
      customer.phoneChannel === "PHONE" ? null : phoneDetails(customer.phoneDigits).whatsappUrl,
      customer.phone2Channel === "PHONE" ? null : phoneDetails(customer.phone2Digits).whatsappUrl,
      customer.phone3Channel === "PHONE" ? null : phoneDetails(customer.phone3Digits).whatsappUrl,
      customer.email,
      STATUS_LABELS[customer.status] ?? customer.status,
      TEMPERATURE_LABELS[customer.temperature] ?? customer.temperature,
      PIPELINE_STAGE_META[customer.pipelineStage].label,
      customer.cycleContactAttempts,
      customer.commercialCycle,
      customer.stageReason,
      [customer.addressStreet, customer.addressNumber].filter(Boolean).join(", ") || null,
      customer.addressComplement,
      customer.addressDistrict,
      customer.zipDigits,
      customer.city,
      customer.state,
      customer.spRegion,
      customer.leadOrigin,
      customer.businessType ? BUSINESS_TYPE_LABELS[customer.businessType] : null,
      customer.industrySegment,
      customer.worksWithSmartwatch == null ? null : customer.worksWithSmartwatch ? "Sim" : "Não",
      customer.interests.map((interest) => CUSTOMER_INTEREST_LABELS[interest]).join(", "),
      customer.interestedBrand ? INTERESTED_BRAND_LABELS[customer.interestedBrand] : null,
      formatDateTime(customer.leadCapturedAt),
      customer.seller.sellerProfile?.displayName ?? customer.seller.name,
      customer.seller.rca,
      formatDateTime(customer.createdAt),
      formatDateTime(customer.lastInteractionAt),
      formatDateTime(customer.followUps[0]?.dueAt),
      customer._count.quotes,
      customer._count.sales,
    ])
  );
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
