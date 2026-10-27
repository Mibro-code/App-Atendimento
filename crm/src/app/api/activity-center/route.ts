import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, forbidden, requireSession } from "@/lib/api-auth";
import { centralActivities, crmActivities, HORIZON_DAYS, type ActivityScope } from "@/lib/activity-center";
import { centralRequest } from "@/lib/central-identity";
import { centralSession } from "@/lib/central-session";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Central de Atividades. Consulta sob demanda (sem polling no servidor):
 * Agenda e recompra do CRM com o RBAC do CRM + retornos da Central da
 * empresa escolhida com a autorização da Central. Uma fonte indisponível não
 * esconde a outra nem é apresentada como "sem atividades".
 */
export async function GET(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const params = req.nextUrl.searchParams;
  const company = params.get("company") || "";
  if (company && !["mibro", "sincrofit"].includes(company)) return badRequest("Empresa inválida.");
  const scope: ActivityScope = params.get("scope") === "team" && (user.role === "SUPERVISOR" || user.role === "ADMIN") ? "team" : "mine";
  const now = new Date();
  const [crm, central] = await Promise.all([crmActivities(user, scope, now), centralActivities(req, user, company, scope)]);
  return NextResponse.json(
    {
      now: now.toISOString(),
      company,
      scope,
      horizonDays: HORIZON_DAYS,
      items: [...crm.items, ...central.items],
      crm: { truncated: crm.truncated },
      central: { status: central.status, counts: central.counts ?? null, truncated: central.truncated ?? false },
    },
    { headers: NO_STORE }
  );
}

const actionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  action: z.enum(["COMPLETE", "RESCHEDULE"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  note: z.string().max(500).optional(),
});

/** Ações em retornos da Central: executadas e autorizadas pela própria Central. */
export async function POST(req: NextRequest) {
  const { user, error } = await requireSession();
  if (error) return error;
  const context = await centralSession(req, user);
  if (!context) return forbidden("Sua conta não tem acesso ao Atendimento.");
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest("Dados inválidos.");
  if (parsed.data.action === "RESCHEDULE" && (!parsed.data.date || !parsed.data.time)) return badRequest("Informe data e horário.");
  try {
    const result = await centralRequest<{ item: unknown }>("/identity/activity-action", { ...context, ...parsed.data });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (failure) {
    const { statusCode, detail } = failure as { statusCode?: number; detail?: string };
    if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 401 && detail) {
      return NextResponse.json({ error: detail }, { status: statusCode, headers: NO_STORE });
    }
    return NextResponse.json({ error: "Atendimento indisponível no momento. Tente novamente." }, { status: 503, headers: NO_STORE });
  }
}
