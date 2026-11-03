import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { requireSession, badRequest, forbidden } from "@/lib/api-auth";
import { canAssignCustomerToSeller, getCustomerScopeFilter } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import {
  CUSTOMER_IMPORT_MAX_BYTES,
  CUSTOMER_IMPORT_MAX_ROWS,
  duplicateKey,
  parseCustomerImportTable,
  parseDelimitedText,
  type CustomerImportIssue,
  type CustomerImportRow,
} from "@/lib/customer-import";

export const runtime = "nodejs";

async function readTable(file: File): Promise<unknown[][]> {
  const extension = file.name.toLowerCase().split(".").pop();
  const arrayBuffer = await file.arrayBuffer();
  if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const table: string[][] = [];
    const lastRow = Math.min(worksheet.rowCount, CUSTOMER_IMPORT_MAX_ROWS + 2);
    const lastColumn = Math.min(worksheet.columnCount, 100);
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values: string[] = [];
      for (let columnNumber = 1; columnNumber <= lastColumn; columnNumber += 1) {
        values.push(row.getCell(columnNumber).text);
      }
      table.push(values);
    }
    return table;
  }
  if (extension === "csv") return parseDelimitedText(Buffer.from(arrayBuffer).toString("utf8"));
  throw new Error("Envie um arquivo CSV ou XLSX.");
}

function duplicateMessage(keys: string[]): string {
  const labels = keys.map((key) => ({ cnpj: "CNPJ", cpf: "CPF", email: "e-mail", phone: "telefone" }[key.split(":")[0]]));
  return `Possível duplicado por ${labels.filter(Boolean).join(", ")}.`;
}

async function classifyDuplicates(rows: CustomerImportRow[], user: { id: string; role: "ADMIN" | "SUPERVISOR" | "VENDEDOR" | "REPRESENTANTE" }) {
  const cnpjs = rows.flatMap((row) => row.cnpjDigits ? [row.cnpjDigits] : []);
  const cpfs = rows.flatMap((row) => row.cpfDigits ? [row.cpfDigits] : []);
  const emails = rows.flatMap((row) => row.email ? [row.email] : []);
  const phones = rows.flatMap((row) => row.phoneDigits ? [row.phoneDigits] : []);
  const or = [
    ...(cnpjs.length ? [{ cnpjDigits: { in: cnpjs } }] : []),
    ...(cpfs.length ? [{ cpfDigits: { in: cpfs } }] : []),
    ...(emails.length ? [{ email: { in: emails } }] : []),
    ...(phones.length ? [{ phoneDigits: { in: phones } }] : []),
  ];
  const existing = or.length
    ? await prisma.customer.findMany({
        where: { AND: [await getCustomerScopeFilter(user), { OR: or }] },
        select: {
          id: true, contactName: true, legalName: true, tradeName: true, cnpjDigits: true, cpfDigits: true,
          email: true, phoneDigits: true, phone2Digits: true, phone3Digits: true, phoneChannel: true, phone2Channel: true, phone3Channel: true, addressStreet: true, addressNumber: true, addressDistrict: true,
          city: true, state: true, spRegion: true, zipDigits: true, leadOrigin: true, businessType: true, industrySegment: true,
          worksWithSmartwatch: true, interests: true, interestedBrand: true, leadCapturedAt: true, notes: true,
          status: true, temperature: true, seller: { select: { name: true } },
        },
      })
    : [];
  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const customer of existing) {
    for (const key of duplicateKey({ ...customer, rowNumber: 0 })) existingByKey.set(key, customer);
  }
  const seenImported = new Set<string>();
  const accepted: CustomerImportRow[] = [];
  const duplicates: Array<{ row: CustomerImportRow; existing: (typeof existing)[number]; matchedKeys: string[] }> = [];
  const duplicateIssues: CustomerImportIssue[] = [];
  for (const row of rows) {
    const keys = duplicateKey(row);
    const matches = [...new Set(keys.flatMap((key) => existingByKey.get(key) ? [existingByKey.get(key)!] : []))];
    if (matches.length === 1) {
      const matchedKeys = keys.filter((key) => existingByKey.get(key)?.id === matches[0].id);
      duplicates.push({ row, existing: matches[0], matchedKeys });
      duplicateIssues.push({ rowNumber: row.rowNumber, message: `${duplicateMessage(matchedKeys)} Pode ser fundido com ${matches[0].tradeName || matches[0].contactName}.` });
      continue;
    }
    if (matches.length > 1) {
      duplicateIssues.push({ rowNumber: row.rowNumber, message: "Os dados coincidem com mais de um cliente. Revise manualmente; a fusão automática foi bloqueada." });
      continue;
    }
    const repeatedInFile = keys.filter((key) => seenImported.has(key));
    if (repeatedInFile.length) {
      duplicateIssues.push({ rowNumber: row.rowNumber, message: `${duplicateMessage(repeatedInFile)} repetido dentro da própria planilha.` });
      continue;
    }
    keys.forEach((key) => seenImported.add(key));
    accepted.push(row);
  }
  return { accepted, duplicates, duplicateIssues };
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Formulário inválido.");
  const file = form.get("file");
  const action = form.get("action") === "import" ? "import" : "preview";
  const mergeDuplicates = form.get("mergeDuplicates") === "true";
  const requestedSellerId = String(form.get("sellerId") || "").trim();
  if (!(file instanceof File)) return badRequest("Selecione uma planilha CSV ou XLSX.");
  if (file.size === 0) return badRequest("O arquivo está vazio.");
  if (file.size > CUSTOMER_IMPORT_MAX_BYTES) return badRequest("O arquivo excede o limite de 5 MB.");

  let sellerId = user.id;
  if (requestedSellerId && requestedSellerId !== user.id) {
    if (!(await canAssignCustomerToSeller(user, requestedSellerId))) {
      return forbidden("Você não pode importar clientes para esse vendedor.");
    }
    sellerId = requestedSellerId;
  }
  const seller = await prisma.user.findFirst({
    where: { id: sellerId, active: true, role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] } },
    select: { id: true, name: true, sellerProfile: { select: { displayName: true } } },
  });
  if (!seller) return badRequest("O responsável selecionado não está ativo.");

  let table: unknown[][];
  try {
    table = await readTable(file);
  } catch (readError) {
    return badRequest(readError instanceof Error ? readError.message : "Não foi possível ler a planilha.");
  }
  const parsed = parseCustomerImportTable(table);
  const { accepted, duplicates, duplicateIssues } = await classifyDuplicates(parsed.rows, user);
  const previewRows = parsed.rows.slice(0, 20).map((row) => ({
    rowNumber: row.rowNumber,
    contactName: row.contactName,
    tradeName: row.tradeName,
    cnpjDigits: row.cnpjDigits,
    email: row.email,
    phoneDigits: row.phoneDigits,
    phone2Digits: row.phone2Digits || null,
    phone3Digits: row.phone3Digits || null,
    phoneChannel: row.phoneDigits ? row.phoneChannel || null : null,
    phone2Channel: row.phone2Digits ? row.phone2Channel || null : null,
    phone3Channel: row.phone3Digits ? row.phone3Channel || null : null,
    city: row.city,
    state: row.state,
    spRegion: row.spRegion,
    businessType: row.businessType,
    industrySegment: row.industrySegment,
    worksWithSmartwatch: row.worksWithSmartwatch,
    interests: row.interests,
    interestedBrand: row.interestedBrand,
    leadCapturedAt: row.leadCapturedAt?.toISOString() ?? null,
  }));

  if (action === "preview") {
    return NextResponse.json({
      validCount: accepted.length,
      invalidCount: parsed.issues.length,
      duplicateCount: duplicateIssues.length,
      mergeableDuplicateCount: duplicates.length,
      duplicates: duplicates.slice(0, 100).map(({ row, existing, matchedKeys }) => ({
        rowNumber: row.rowNumber,
        incomingName: row.tradeName || row.contactName,
        existing: { id: existing.id, name: existing.tradeName || existing.contactName, legalName: existing.legalName, sellerName: existing.seller.name },
        matchedBy: matchedKeys.map((key) => ({ cnpj: "CNPJ", cpf: "CPF", email: "e-mail", phone: "telefone" }[key.split(":")[0]])).filter(Boolean),
      })),
      issues: [...parsed.issues, ...duplicateIssues].slice(0, 100),
      previewRows,
      seller: { id: seller.id, name: seller.sellerProfile?.displayName ?? seller.name },
    });
  }

  if (accepted.length === 0 && (!mergeDuplicates || duplicates.length === 0)) {
    return badRequest("Nenhum cliente válido e não duplicado para importar.", { issues: [...parsed.issues, ...duplicateIssues] });
  }

  const result = await prisma.$transaction(async (tx) => {
    const created = accepted.length ? await tx.customer.createMany({
      data: accepted.map(({ rowNumber: _rowNumber, ...row }) => ({ ...row, sellerId })),
    }) : { count: 0 };
    let mergedCount = 0;
    if (mergeDuplicates) for (const { row, existing } of duplicates) {
      await tx.customer.update({
        where: { id: existing.id },
        data: {
          legalName: existing.legalName || row.legalName,
          tradeName: existing.tradeName || row.tradeName,
          cnpjDigits: existing.cnpjDigits || row.cnpjDigits,
          cpfDigits: existing.cpfDigits || row.cpfDigits,
          email: existing.email || row.email,
          phoneDigits: existing.phoneDigits || row.phoneDigits,
          phone2Digits: existing.phone2Digits || row.phone2Digits || null,
          phone3Digits: existing.phone3Digits || row.phone3Digits || null,
          phoneChannel: existing.phoneDigits ? existing.phoneChannel : row.phoneChannel || null,
          phone2Channel: existing.phone2Digits ? existing.phone2Channel : row.phone2Channel || null,
          phone3Channel: existing.phone3Digits ? existing.phone3Channel : row.phone3Channel || null,
          addressStreet: existing.addressStreet || row.addressStreet,
          addressNumber: existing.addressNumber || row.addressNumber,
          addressDistrict: existing.addressDistrict || row.addressDistrict,
          city: existing.city || row.city,
          state: existing.state || row.state,
          spRegion: existing.spRegion || row.spRegion,
          zipDigits: existing.zipDigits || row.zipDigits,
          leadOrigin: existing.leadOrigin || row.leadOrigin,
          businessType: existing.businessType || row.businessType,
          industrySegment: existing.industrySegment || row.industrySegment,
          worksWithSmartwatch: existing.worksWithSmartwatch ?? row.worksWithSmartwatch,
          interests: { set: [...new Set([...existing.interests, ...row.interests])] },
          interestedBrand: existing.interestedBrand || row.interestedBrand,
          leadCapturedAt: existing.leadCapturedAt || row.leadCapturedAt,
          notes: existing.notes || row.notes,
          status: existing.status === "NOVO" ? row.status : existing.status,
          temperature: existing.temperature === "SEM_CLASSIFICACAO" ? row.temperature : existing.temperature,
        },
      });
      mergedCount += 1;
    }
    return { createdCount: created.count, mergedCount };
  });
  await logAudit({
    actorId: user.id,
    action: "CUSTOMERS_IMPORTED",
    entityType: "CustomerImport",
    metadata: {
      sellerId,
      fileName: file.name.slice(0, 200),
      createdCount: result.createdCount,
      mergedCount: result.mergedCount,
      invalidCount: parsed.issues.length,
      duplicateCount: duplicateIssues.length,
    },
  });

  return NextResponse.json({
    createdCount: result.createdCount,
    mergedCount: result.mergedCount,
    invalidCount: parsed.issues.length,
    duplicateCount: duplicateIssues.length,
    issues: [...parsed.issues, ...duplicateIssues].slice(0, 100),
  }, { status: 201 });
}
