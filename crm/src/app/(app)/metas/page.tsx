import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getVisibleSellerIds } from "@/lib/authz";
import { syncGoalAlerts } from "@/lib/goal-alerts";
import { computeGoalProgress } from "@/lib/goals";
import { GoalForm } from "./goal-form";
import { GoalProgressCard } from "./goal-progress-card";
import { GoalHistoryList } from "./goal-history-list";
import { TeamGoalsTable } from "./team-goals-table";
import { NotificationsPanel } from "./notifications-panel";

export default async function MetasPage() {
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  if (user.role === "REPRESENTANTE") redirect("/dashboard");

  // Sync "pull-based" (mesmo padrão de syncAutomaticFollowUpsForScope): toda
  // vez que alguém abre /metas, recalcula status/alertas de TODAS as metas
  // ativas do sistema — não só as do usuário logado — para que vendedor e
  // supervisor recebam o aviso mesmo que só um dos dois entre no app.
  await syncGoalAlerts();

  const notifications = await prisma.notification.findMany({
    where: { recipientId: user.id, readAt: null, type: { in: ["GOAL_WARNING", "GOAL_ACHIEVED", "GOAL_EXPIRED"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const notificationItems = notifications.map((n) => ({ id: n.id, title: n.title, message: n.message }));

  if (user.role === "VENDEDOR") {
    const goals = await prisma.salesGoal.findMany({
      where: { sellerId: user.id },
      orderBy: { endDate: "desc" },
    });
    const current = goals.find((g) => g.status === "ACTIVE") ?? null;
    const history = goals.filter((g) => g.id !== current?.id);
    const currentProgress = current ? await computeGoalProgress(current) : null;

    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Minha meta</h1>
          <p className="text-sm text-gray-500">
            Acompanhe seu progresso. Só o seu supervisor ou um administrador pode criar ou editar sua meta.
          </p>
        </div>

        <NotificationsPanel initialNotifications={notificationItems} />

        {current && currentProgress ? (
          <GoalProgressCard goal={current} progress={currentProgress} />
        ) : (
          <p className="text-sm text-gray-400 card p-6">Você ainda não tem nenhuma meta cadastrada.</p>
        )}

        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Histórico de metas</h2>
          <GoalHistoryList goals={history} />
        </div>
      </div>
    );
  }

  // SUPERVISOR / ADMIN
  const visible = await getVisibleSellerIds(user);
  const sellers = await prisma.user.findMany({
    where:
      visible === null
        ? { role: "VENDEDOR", active: true }
        : { id: { in: visible.filter((id) => id !== user.id) }, role: "VENDEDOR", active: true },
    select: { id: true, name: true, sellerProfile: { select: { displayName: true } } },
    orderBy: { name: "asc" },
  });

  const activeGoals = await prisma.salesGoal.findMany({
    where: visible === null ? { status: "ACTIVE" } : { status: "ACTIVE", sellerId: { in: visible } },
    include: {
      seller: { select: { name: true, sellerProfile: { select: { displayName: true } } } },
    },
    orderBy: { endDate: "asc" },
  });
  const teamRows = await Promise.all(
    activeGoals.map(async (goal) => ({ goal, progress: await computeGoalProgress(goal) }))
  );

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 mb-1">Metas da equipe</h1>
        <p className="text-sm text-gray-500">Crie e acompanhe metas de valor ou de quantidade de vendas por vendedor.</p>
      </div>

      <NotificationsPanel initialNotifications={notificationItems} />

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Nova meta</h2>
        <GoalForm
          sellers={sellers.map((s) => ({ id: s.id, name: s.sellerProfile?.displayName || s.name }))}
        />
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Metas ativas da equipe</h2>
        <TeamGoalsTable rows={teamRows} />
      </div>
    </div>
  );
}
