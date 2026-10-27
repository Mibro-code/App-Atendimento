import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getCustomerScopeFilter } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { FollowUpActions } from "./followup-actions";
import { applyDueStageReturns } from "@/lib/pipeline";
import { attemptStars, followUpBucketRange, PIPELINE_STAGE_META } from "@/lib/pipeline-rules";
import type { PipelineStage } from "@prisma/client";

const TAB_LIMIT = 100;

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = "atrasados" } = await searchParams;
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const scope = await getCustomerScopeFilter(user);
  await applyDueStageReturns(scope);

  // Esta tela é exclusiva de recompra: somente clientes que já compraram e
  // entraram na etapa própria de follow-up após o prazo do vendedor.
  const base: Prisma.FollowUpWhereInput = {
    status: "PENDENTE",
    customer: { AND: [scope, { pipelineStage: "FOLLOW_UP", lastSaleAt: { not: null } }] },
  };
  const ranges = {
    atrasados: followUpBucketRange("OVERDUE"),
    hoje: followUpBucketRange("TODAY"),
    proximos: followUpBucketRange("FUTURE"),
  };
  const activeTab = (tab in ranges ? tab : "atrasados") as keyof typeof ranges;
  const [overdueCount, todayCount, upcomingCount, items] = await Promise.all([
    prisma.followUp.count({ where: { ...base, dueAt: ranges.atrasados } }),
    prisma.followUp.count({ where: { ...base, dueAt: ranges.hoje } }),
    prisma.followUp.count({ where: { ...base, dueAt: ranges.proximos } }),
    prisma.followUp.findMany({
      where: { ...base, dueAt: ranges[activeTab] },
      include: { customer: { select: { id: true, contactName: true, tradeName: true, pipelineStage: true, cycleContactAttempts: true } } },
      orderBy: { dueAt: "asc" },
      take: TAB_LIMIT,
    }),
  ]);

  const counts = { atrasados: overdueCount, hoje: todayCount, proximos: upcomingCount };
  const tabs = [
    { key: "atrasados", label: `Atrasados (${overdueCount})` },
    { key: "hoje", label: `Hoje (${todayCount})` },
    { key: "proximos", label: `Próximos (${upcomingCount})` },
  ];
  const empty = {
    atrasados: "Nenhum follow-up de recompra atrasado. Bom trabalho!",
    hoje: "Nenhum follow-up de recompra para hoje.",
    proximos: "Nenhum follow-up de recompra futuro agendado.",
  };

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Follow-up de recompra</h1>
      <p className="text-sm text-gray-500 mb-6">
        Acompanhe clientes que já compraram para oferecer novos produtos após o prazo configurado para o responsável (30 dias por padrão).
        O Follow-up do funil em Clientes controla as tentativas de contato após atendimento; esta página mostra somente oportunidades de recompra.
      </p>

      <div className="flex gap-2 mb-6 border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/follow-ups?tab=${t.key}`}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === t.key ? "border-brand text-brand" : "border-transparent text-gray-500"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {items.map((f) => (
          <FollowUpCard
            key={f.id}
            id={f.id}
            customerId={f.customer.id}
            title={f.customer.tradeName || f.customer.contactName}
            dueAt={f.dueAt}
            note={f.note}
            stage={f.customer.pipelineStage}
            attempts={f.customer.cycleContactAttempts}
          />
        ))}
        {items.length === 0 && <p className="text-gray-400 text-sm">{empty[activeTab]}</p>}
        {counts[activeTab] > items.length && (
          <p className="text-xs text-gray-500">
            Mostrando os {items.length} mais antigos de {counts[activeTab]}. Use o funil em <Link className="text-brand underline" href="/clientes?followUp=OVERDUE">Clientes</Link> para filtrar por data e tentativas.
          </p>
        )}
      </div>
    </div>
  );
}

function FollowUpCard({
  id,
  customerId,
  title,
  dueAt,
  note,
  stage,
  attempts,
}: {
  id: string;
  customerId: string;
  title: string;
  dueAt: Date;
  note: string | null;
  stage: PipelineStage;
  attempts: number;
}) {
  const stars = attemptStars(attempts);
  return (
    <div className="card p-4 flex items-center justify-between gap-4">
      <div>
        <Link href={`/clientes/${customerId}`} className="font-medium text-gray-900 hover:text-brand">{title}</Link>
        <p className="text-xs text-gray-500">
          Previsto para {formatDateTime(dueAt)}
          {note ? ` · ${note}` : ""}
        </p>
        <p className="text-xs text-gray-400">
          {PIPELINE_STAGE_META[stage].label} · <span className="text-amber-500">{"★".repeat(stars.filled)}</span><span className="text-gray-300">{"☆".repeat(stars.total - stars.filled)}</span>
        </p>
      </div>
      <FollowUpActions id={id} />
    </div>
  );
}
