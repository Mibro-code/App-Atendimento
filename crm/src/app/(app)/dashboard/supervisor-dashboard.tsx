"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { formatCentsToBRL as money } from "@/lib/format";

const TeamPerformanceChart = dynamic(() => import("@/components/dashboard-charts").then((module) => module.TeamPerformanceChart), { ssr: false, loading: () => <div className="h-full animate-pulse rounded bg-gray-100" aria-label="Carregando gráfico"/> });
const SalesTrendChart = dynamic(() => import("@/components/dashboard-charts").then((module) => module.SalesTrendChart), { ssr: false, loading: () => <div className="h-full animate-pulse rounded bg-gray-100" aria-label="Carregando gráfico"/> });

type TeamMember = { id: string; name: string; role: "VENDEDOR" | "REPRESENTANTE"; active: boolean; salesValueCents: number; orders: number; averageTicketCents: number; customers: number; goal: null | { type: "REVENUE" | "SALES_COUNT"; target: number; current: number; percent: number } };
type DailyOrder={id:string;brand:"MIBRO"|"SINCROFIT";number:string;valueCents:number;status:string;followUpStatus:"PENDING"|"NOTIFIED"|"RESOLVED";createdAt:string;customer:{id:string;name:string};seller:{id:string;name:string};notifiedAt:string|null;resolvedAt:string|null};
type DashboardData = { summary: { totalValueCents: number; orders: number; openQuotes:number; averageTicketCents: number; salesChangePercent: number | null; ordersChangePercent: number | null; teamGoalTargetCents: number; teamGoalCurrentCents: number; teamGoalPercent: number }; team: TeamMember[]; trend: Array<{ key: string; label: string; valueCents: number }>;orderFollowUpAssignee:{id:string;name:string}|null;dailyOrders:DailyOrder[] };
const pct = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const roleLabel = (role: string) => role === "REPRESENTANTE" ? "Representante" : "Vendedor";

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-gray-400">Sem base anterior</span>;
  return <span className={`text-xs font-medium ${value >= 0 ? "text-emerald-600" : "text-red-600"}`}>{value >= 0 ? "↑" : "↓"} {pct(Math.abs(value))} vs. período anterior</span>;
}


export function SupervisorDashboard() {
  const router = useRouter();
  const [period, setPeriod] = useState("month"); const [brand, setBrand] = useState("all"); const [teamType, setTeamType] = useState("all");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [data, setData] = useState<DashboardData | null>(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(""); const [sort, setSort] = useState("sales");
  const [orderAction,setOrderAction]=useState<string|null>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    const params = new URLSearchParams({ period, brand, teamType });
    if (period === "custom" && from && to) { params.set("from", from); params.set("to", to); }
    fetch(`/api/supervisor/dashboard?${params}`, { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error((await response.json()).error || "Erro ao carregar dashboard."); return response.json(); })
      .then(setData).catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [period, brand, teamType, from, to]);
  const team = useMemo(() => [...(data?.team ?? [])].filter((member) => member.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "orders" ? b.orders-a.orders : sort === "ticket" ? b.averageTicketCents-a.averageTicketCents : sort === "goal" ? (b.goal?.percent ?? 0)-(a.goal?.percent ?? 0) : b.salesValueCents-a.salesValueCents), [data, query, sort]);
  async function updateOrder(orderId:string,status:"NOTIFIED"|"RESOLVED"){
    setOrderAction(orderId);const response=await fetch(`/api/supervisor/orders/${orderId}/follow-up`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});setOrderAction(null);
    if(!response.ok){setError((await response.json().catch(()=>({}))).error||"Não foi possível atualizar o pedido.");return;}
    setData((current)=>current?{...current,dailyOrders:current.dailyOrders.map((order)=>order.id===orderId?{...order,followUpStatus:status}:order)}:current);
  }
  if (error) return <div className="card p-6 text-center"><p className="text-red-600">{error}</p><button className="btn-secondary mt-3" onClick={() => location.reload()}>Tentar novamente</button></div>;
  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-brand">Visão executiva</p><h1 className="text-2xl font-semibold text-gray-950">Dashboard comercial</h1><p className="text-sm text-gray-500">Resultados reais da equipe, pedidos confirmados e metas.</p></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <select aria-label="Período" className="input-field" value={period} onChange={(e)=>setPeriod(e.target.value)}><option value="today">Hoje</option><option value="week">Esta semana</option><option value="month">Este mês</option><option value="30days">Últimos 30 dias</option><option value="year">Este ano</option><option value="custom">Personalizado</option></select>
      <select aria-label="Empresa" className="input-field" value={brand} onChange={(e)=>setBrand(e.target.value)}><option value="all">Todas as empresas</option><option value="MIBRO">Mibro</option><option value="SINCROFIT">Sincrofit</option></select>
      <select aria-label="Tipo de equipe" className="input-field" value={teamType} onChange={(e)=>setTeamType(e.target.value)}><option value="all">Toda a equipe</option><option value="VENDEDOR">Vendedores</option><option value="REPRESENTANTE">Representantes</option></select>
    </div></div>
    {period === "custom" && <div className="flex gap-2"><input aria-label="Data inicial" className="input-field max-w-48" type="date" value={from} onChange={(e)=>setFrom(e.target.value)} /><input aria-label="Data final" className="input-field max-w-48" type="date" value={to} onChange={(e)=>setTo(e.target.value)} /></div>}
    {loading || !data ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[1,2,3,4,5].map((item)=><div key={item} className="card h-24 animate-pulse bg-gray-100" />)}</div> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card p-4"><p className="text-xs text-gray-500">Vendas</p><p className="mt-2 text-xl font-semibold lg:text-2xl">{money(data.summary.totalValueCents)}</p><Change value={data.summary.salesChangePercent}/></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Pedidos</p><p className="mt-2 text-xl font-semibold lg:text-2xl">{data.summary.orders}</p><Change value={data.summary.ordersChangePercent}/></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Cotações em aberto</p><p className="mt-2 text-xl font-semibold lg:text-2xl">{data.summary.openQuotes}</p><button className="text-xs text-brand hover:underline" onClick={()=>router.push('/cotacoes?open=1')}>Ver cotações</button></div>
        <div className="card p-3"><p className="text-[11px] text-gray-500">Ticket médio</p><p className="mt-1 text-lg font-semibold">{money(data.summary.averageTicketCents)}</p><span className="text-[10px] text-gray-400">por pedido confirmado</span></div>
        <div className="card p-4"><p className="text-xs text-gray-500">Meta da equipe</p><p className="mt-2 text-lg font-semibold">{money(data.summary.teamGoalCurrentCents)} <span className="text-sm font-normal text-gray-400">/ {money(data.summary.teamGoalTargetCents)}</span></p><div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand transition-all" style={{width:`${Math.min(100,data.summary.teamGoalPercent)}%`}} /></div><p className="mt-1 text-xs font-medium">{pct(data.summary.teamGoalPercent)}</p></div>
      </div>
      <section className={`card overflow-hidden ${data.dailyOrders.some((order)=>order.followUpStatus!=="RESOLVED")?"border-amber-300":""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4"><div><h2 className="font-semibold">Pedidos do dia</h2><p className="text-xs text-gray-500">Acompanhe a comunicação externa{data.orderFollowUpAssignee?` com ${data.orderFollowUpAssignee.name}`:" com a pessoa responsável"}.</p></div><span className="badge bg-amber-100 text-amber-800">{data.dailyOrders.filter((order)=>order.followUpStatus!=="RESOLVED").length} pendente(s)</span></div>
        <div className="divide-y divide-gray-100">{data.dailyOrders.map((order)=><div key={order.id} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">{order.customer.name} · {order.brand}</p><p className="text-xs text-gray-500">Pedido {order.number} · {order.seller.name} · {money(order.valueCents)}</p></div><div className="flex items-center gap-2"><span className={`badge ${order.followUpStatus==="RESOLVED"?"bg-green-100 text-green-700":order.followUpStatus==="NOTIFIED"?"bg-blue-100 text-blue-700":"bg-amber-100 text-amber-800"}`}>{order.followUpStatus==="RESOLVED"?"Resolvido":order.followUpStatus==="NOTIFIED"?`${data.orderFollowUpAssignee?.name||"Responsável"} avisada(o)`:"Pendente de avisar"}</span>{order.followUpStatus==="PENDING"&&<button className="btn-secondary" disabled={orderAction===order.id} onClick={()=>updateOrder(order.id,"NOTIFIED")}>Marcar como avisado</button>}{order.followUpStatus!=="RESOLVED"&&<button className="btn-primary" disabled={orderAction===order.id} onClick={()=>updateOrder(order.id,"RESOLVED")}>Resolvido</button>}</div></div>)}{!data.dailyOrders.length&&<p className="p-6 text-center text-sm text-gray-400">Nenhum pedido criado hoje.</p>}</div>
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section className="card p-4"><h2 className="font-semibold">Desempenho da equipe</h2><p className="mb-4 text-xs text-gray-500">Clique em uma barra para abrir os detalhes.</p>{data.summary.orders > 0 ? <div style={{height:Math.max(280,data.team.length*48)}}><TeamPerformanceChart team={data.team}/></div> : <p className="py-16 text-center text-sm text-gray-400">Nenhuma venda encontrada neste período.</p>}</section>
        <section className="card p-4"><h2 className="font-semibold">Ranking da equipe</h2><div className="mt-4 space-y-3">{data.team.slice(0,5).map((member,index)=><button key={member.id} onClick={()=>router.push(`/equipe/${member.id}`)} className="w-full rounded-lg border border-gray-100 p-3 text-left transition hover:border-gray-300 hover:bg-gray-50"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-xs font-semibold">{index+1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.name}</p><p className="text-xs text-gray-400">{roleLabel(member.role)} · {money(member.salesValueCents)}</p></div><span className="text-xs font-medium">{member.goal ? pct(member.goal.percent) : "Sem meta"}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-brand" style={{width:`${Math.min(100,member.goal?.percent ?? 0)}%`}}/></div></button>)}{!data.team.length&&<p className="py-10 text-center text-sm text-gray-400">Nenhum profissional vinculado.</p>}</div></section>
      </div>
      <section className="card p-4"><h2 className="font-semibold">Evolução das vendas</h2><div className="mt-4 h-72"><SalesTrendChart trend={data.trend} brand={brand} activeDot/></div></section>
      <TeamList team={team} query={query} setQuery={setQuery} sort={sort} setSort={setSort} open={(id)=>router.push(`/equipe/${id}`)} />
    </>}
  </div>;
}

function TeamList({ team, query, setQuery, sort, setSort, open }: { team: TeamMember[]; query: string; setQuery: (value:string)=>void; sort:string; setSort:(value:string)=>void; open:(id:string)=>void }) {
  return <section><div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><h2 className="font-semibold">Equipe</h2><p className="text-xs text-gray-500">Vendedores e representantes vinculados.</p></div><div className="flex gap-2"><input className="input-field" placeholder="Buscar por nome" value={query} onChange={(e)=>setQuery(e.target.value)}/><select className="input-field" value={sort} onChange={(e)=>setSort(e.target.value)}><option value="sales">Vendas ↓</option><option value="orders">Pedidos ↓</option><option value="ticket">Ticket ↓</option><option value="goal">Meta atingida ↓</option><option value="name">Nome</option></select></div></div><div className="hidden overflow-hidden md:block card"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-gray-500"><tr>{["Funcionário","Tipo","Vendas","Pedidos","Ticket médio","Meta","Clientes","Status"].map(h=><th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y">{team.map(member=><tr key={member.id} onClick={()=>open(member.id)} className="cursor-pointer hover:bg-gray-50"><td className="px-3 py-3 font-medium">{member.name}</td><td className="px-3 py-3">{roleLabel(member.role)}</td><td className="px-3 py-3">{money(member.salesValueCents)}</td><td className="px-3 py-3">{member.orders}</td><td className="px-3 py-3">{money(member.averageTicketCents)}</td><td className="px-3 py-3">{member.goal ? pct(member.goal.percent) : "Sem meta"}</td><td className="px-3 py-3">{member.customers}</td><td className="px-3 py-3">{member.active ? "Ativo" : "Inativo"}</td></tr>)}</tbody></table></div><div className="space-y-3 md:hidden">{team.map(member=><button key={member.id} onClick={()=>open(member.id)} className="card w-full p-4 text-left"><div className="flex justify-between"><div><p className="font-medium">{member.name}</p><p className="text-xs text-gray-500">{roleLabel(member.role)}</p></div><span className="text-sm font-semibold">{money(member.salesValueCents)}</span></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-500"><span>{member.orders} pedidos</span><span>{member.customers} clientes</span><span>{member.goal ? pct(member.goal.percent) : "Sem meta"}</span></div></button>)}</div></section>;
}
