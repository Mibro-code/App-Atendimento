import { NextRequest, NextResponse } from "next/server";
import type { Prisma, RepresentativeType, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/api-auth";
import { getVisibleSellerIds } from "@/lib/authz";
import { rcaFromQuery } from "@/lib/rca";
import { regionMatchScore } from "@/lib/representative-regions";

const ROLES: Role[] = ["ADMIN", "SUPERVISOR", "VENDEDOR", "REPRESENTANTE"];
const TYPES: RepresentativeType[] = ["ATACADO", "VAREJO", "OUTRO"];

/**
 * Busca de responsáveis para seletores grandes (atribuição, transferência,
 * filtros, comissões). Encontra por nome, e-mail, RCA ("027"), tipo e região.
 * Respeita o RBAC: supervisor só vê a própria equipe; vendedor/representante
 * só a si mesmo. Quando `state`/`city` do cliente são informados, quem atende
 * a região aparece primeiro (nunca atribui automaticamente).
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const params = req.nextUrl.searchParams;
  const q = params.get("q")?.trim().slice(0, 100) ?? "";
  const roles = (params.get("roles")?.split(",") ?? []).filter((role): role is Role => ROLES.includes(role as Role));
  const type = TYPES.find((value) => value === params.get("representativeType"));
  const state = params.get("state")?.trim().toUpperCase() || null;
  const city = params.get("city")?.trim() || null;
  const limit = Math.min(50, Math.max(1, Number(params.get("limit")) || 20));

  const visible = await getVisibleSellerIds(user);
  const rca = rcaFromQuery(q);
  const text: Prisma.UserWhereInput[] = q
    ? [
        { name: { contains: q, mode: "insensitive" } },
        { sellerProfile: { displayName: { contains: q, mode: "insensitive" } } },
        { sellerProfile: { region: { contains: q, mode: "insensitive" } } },
        { representativeRegions: { some: { city: { contains: q, mode: "insensitive" } } } },
        ...(/^[a-z]{2}$/i.test(q) ? [{ representativeRegions: { some: { state: q.toUpperCase() } } }] : []),
        ...(user.role === "ADMIN" || user.role === "SUPERVISOR" ? [{ email: { contains: q, mode: "insensitive" as const } }] : []),
        ...(rca ? [{ rca }] : []),
      ]
    : [];

  const users = await prisma.user.findMany({
    where: {
      active: true,
      deletedAt: null,
      role: { in: roles.length ? roles : ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] },
      ...(visible ? { id: { in: visible } } : {}),
      ...(type ? { sellerProfile: { representativeType: type } } : {}),
      ...(text.length ? { OR: text } : {}),
    },
    select: {
      id: true, name: true, email: true, rca: true, role: true,
      sellerProfile: { select: { displayName: true, representativeType: true } },
      representativeRegions: { select: { state: true, city: true } },
    },
    orderBy: { name: "asc" },
    take: state ? 200 : limit,
  });

  const results = users
    .map((item) => ({
      id: item.id,
      name: item.sellerProfile?.displayName || item.name,
      email: user.role === "ADMIN" || user.role === "SUPERVISOR" ? item.email : null,
      rca: item.rca,
      role: item.role,
      representativeType: item.sellerProfile?.representativeType ?? null,
      regions: item.representativeRegions,
      regionScore: regionMatchScore(item.representativeRegions, state, city),
      // RCA exato primeiro na busca por código.
      exactRca: rca !== null && item.rca === rca,
    }))
    .sort((a, b) => Number(b.exactRca) - Number(a.exactRca) || b.regionScore - a.regionScore || a.name.localeCompare(b.name, "pt-BR"))
    .slice(0, limit)
    .map(({ exactRca: _exactRca, ...rest }) => rest);

  return NextResponse.json({ users: results });
}
