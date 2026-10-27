import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden, fieldErrorsFromZod, validationFailed } from "@/lib/api-auth";
import { canAssignCustomerToSeller, getCustomerScopeFilter } from "@/lib/authz";
import { onlyDigits, normalizeEmail } from "@/lib/format";
import { findPossibleDuplicates } from "@/lib/duplicates";
import { logAudit } from "@/lib/audit";
import {centralContactSource,contactLinkKey,exactPhoneVariants,type CentralContactSource} from '@/lib/central-contact-source';
import {
  buildCustomerListWhere,
  CustomerFilterForbiddenError,
  parseCustomerListFilters,
} from "@/lib/customer-list";
import { locationInputSchema, buildLocationCaptureData } from "@/lib/location";
import {
  requiredContactName, optionalString, optionalEmail, optionalCpf, optionalCnpj, optionalPhone, optionalEnum,
} from "@/lib/customer-validation";

// Regra central: só o nome é obrigatório. Todo campo opcional aceita ""
// (o que um <input>/<select> vazio sempre manda) sem virar erro de formato —
// ver src/lib/customer-validation.ts.
const createCustomerSchema = z.object({
  contactName: requiredContactName,
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
  notes: optionalString(),
  sellerId: z.string().optional(), // apenas admin/supervisor podem definir outro vendedor
  confirmDuplicate: z.boolean().optional(),
  attendanceConversationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
  locationAttempt: locationInputSchema.optional(),
});

export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

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
  });
  let where;
  try {
    where = await buildCustomerListWhere(user, filters);
  } catch (filterError) {
    if (filterError instanceof CustomerFilterForbiddenError) {
      return forbidden("Vendedor fora do seu escopo.");
    }
    throw filterError;
  }

  const customers = await prisma.customer.findMany({
    where,
    include: { seller: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ customers });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const body = await req.json().catch(() => null);
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return validationFailed(fieldErrorsFromZod(parsed.error));
  }
  const data = parsed.data;
  let source:CentralContactSource|null=null;
  if(data.attendanceConversationId){
    try{source=await centralContactSource(req,user,data.attendanceConversationId);}catch{return forbidden('Você não pode importar este atendimento.');}
    const existing=await prisma.centralContactLink.findUnique({where:{attendanceCompanyId_attendanceContactId:contactLinkKey(source)},select:{id:true}});
    if(existing)return NextResponse.json({error:'Este contato já possui vínculo no CRM. Atualize a ficha para consultar.'},{status:409});
  }
  const normalizedState = data.state?.trim().toUpperCase() || (data.spRegion ? "SP" : null);
  if (data.spRegion && normalizedState !== "SP") {
    return badRequest("A região de SP só pode ser informada para clientes do estado SP.");
  }

  // Só admin/supervisor podem atribuir um cliente a outro vendedor.
  let sellerId = user.id;
  if (data.sellerId && data.sellerId !== user.id) {
    if (!(await canAssignCustomerToSeller(user, data.sellerId))) {
      return forbidden("Você não pode atribuir clientes a esse vendedor.");
    }
    sellerId = data.sellerId;
  }

  const cnpjDigits = onlyDigits(data.cnpjDigits) || null;
  const cpfDigits = onlyDigits(data.cpfDigits) || null;
  const email = data.email ? normalizeEmail(data.email) : null;
  const phoneDigits = onlyDigits(data.phoneDigits) || null;

  if (source || !data.confirmDuplicate) {
    const duplicateScope = await getCustomerScopeFilter(user);
    let duplicates = await findPossibleDuplicates({
      cnpjDigits,
      cpfDigits,
      email,
      phoneDigits,
      scope: duplicateScope,
    });
    if(source&&!duplicates.length){
      const variants=exactPhoneVariants([...source.phones,phoneDigits||'']);
      duplicates=await prisma.customer.findMany({where:{AND:[duplicateScope,{OR:[{phoneDigits:{in:variants}},{phone2Digits:{in:variants}},{phone3Digits:{in:variants}}]}]},select:{id:true,contactName:true,legalName:true,tradeName:true,cnpjDigits:true,cpfDigits:true,email:true,phoneDigits:true,sellerId:true,seller:{select:{name:true}}},take:10});
    }
    if (duplicates.length > 0) {
      return NextResponse.json(
        {
          possibleDuplicates: duplicates,
          message:
            "Já existem clientes com CNPJ, CPF, e-mail ou telefone parecidos. Confirme para cadastrar mesmo assim.",
        },
        { status: 409 }
      );
    }
  }

  let customer;
  try{customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({ data: {
      contactName: data.contactName,
      legalName: data.legalName || null,
      tradeName: data.tradeName || null,
      cnpjDigits,
      cpfDigits,
      email,
      phoneDigits,
      phone2Digits: data.phone2Digits || null,
      phone3Digits: data.phone3Digits || null,
      phoneChannel: phoneDigits ? data.phoneChannel || null : null,
      phone2Channel: data.phone2Digits ? data.phone2Channel || null : null,
      phone3Channel: data.phone3Digits ? data.phone3Channel || null : null,
      addressStreet: data.addressStreet || null,
      addressNumber: data.addressNumber || null,
      addressDistrict: data.addressDistrict || null,
      addressComplement: data.addressComplement || null,
      city: data.city || null,
      state: normalizedState,
      spRegion: data.spRegion?.trim() || null,
      zipDigits: onlyDigits(data.zipDigits) || null,
      leadOrigin: data.leadOrigin || null,
      businessType: data.businessType || null,
      industrySegment: data.industrySegment || null,
      worksWithSmartwatch: data.worksWithSmartwatch ?? null,
      interests: data.interests ?? [],
      interestedBrand: data.interestedBrand || null,
      leadCapturedAt: new Date(),
      notes: data.notes || null,
      sellerId,
    } });
    if(source)await tx.centralContactLink.create({data:{...contactLinkKey(source),customerId:created.id,confirmedBy:user.id}});
    if (data.locationAttempt) {
      await tx.locationCapture.create({
        data: buildLocationCaptureData({
          location: data.locationAttempt,
          sellerId: user.id,
          customerId: created.id,
          locationSource: "CUSTOMER_CREATED",
        }),
      });
    }
    return created;
  });}catch(e){
    if(source&&(e as {code?:string}).code==='P2002')return NextResponse.json({error:'O contato foi vinculado por outra operação. Atualize a ficha; nenhum cadastro duplicado foi salvo.'},{status:409});
    throw e;
  }

  await logAudit({
    actorId: user.id,
    action: "CUSTOMER_CREATED",
    entityType: "Customer",
    entityId: customer.id,
    metadata: {
      sellerId,
      ...(source?contactLinkKey(source):{}),
      ...(data.locationAttempt ? { locationStatus: data.locationAttempt.status } : {}),
    },
  });

  return NextResponse.json({ customer }, { status: 201 });
}
