"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCentsToBRL as money } from "@/lib/format";

type ChartMember = {
  id: string; name: string; role: "VENDEDOR" | "REPRESENTANTE";
  salesValueCents: number; orders: number; averageTicketCents: number;
  goal: null | { type: "REVENUE" | "SALES_COUNT"; target: number; percent: number };
};

function PerformanceTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartMember }> }) {
  const member = payload?.[0]?.payload;
  if (!active || !member) return null;
  return <div className="rounded-lg border bg-white p-3 text-xs shadow-lg"><p className="text-sm font-semibold">{member.name}</p><p className="mb-2 text-gray-400">{member.role === "REPRESENTANTE" ? "Representante" : "Vendedor"}</p><p>Vendas: <strong>{money(member.salesValueCents)}</strong></p><p>Pedidos: <strong>{member.orders}</strong></p><p>Ticket médio: <strong>{money(member.averageTicketCents)}</strong></p><p>Meta: <strong>{member.goal ? (member.goal.type === "REVENUE" ? money(member.goal.target) : `${member.goal.target} vendas`) : "Não definida"}</strong></p><p>Atingido: <strong>{member.goal ? `${member.goal.percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "-"}</strong></p></div>;
}

export function TeamPerformanceChart({ team }: { team: ChartMember[] }) {
  const router = useRouter();
  return <ResponsiveContainer width="100%" height="100%"><BarChart data={team} layout="vertical" margin={{ left: 10, right: 20 }} onClick={(state) => {
    const clicked = state as unknown as { activePayload?: Array<{ payload: ChartMember }> };
    const item = clicked.activePayload?.[0]?.payload;
    if (item) router.push(`/equipe/${item.id}`);
  }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" tickFormatter={(value) => money(Number(value)).replace(/,00$/, "")} fontSize={11}/><YAxis dataKey="name" type="category" width={100} fontSize={11}/><Tooltip content={<PerformanceTooltip/>} cursor={{ fill: "#f8fafc" }}/><Bar dataKey="salesValueCents" radius={[0, 8, 8, 0]} cursor="pointer">{team.map((item) => <Cell key={item.id} fill={item.role === "REPRESENTANTE" ? "#24A8B4" : "#FF6633"}/>)}</Bar></BarChart></ResponsiveContainer>;
}

export function SalesTrendChart({ trend, brand, activeDot = false }: {
  trend: Array<{ key: string; label: string; valueCents: number }>;
  brand: string;
  activeDot?: boolean;
}) {
  return <ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="label" fontSize={11} minTickGap={24}/><YAxis tickFormatter={(value) => money(Number(value)).replace(/,00$/, "")} fontSize={11} width={82}/><Tooltip formatter={(value) => money(Number(value))}/><Line type="monotone" dataKey="valueCents" stroke={brand === "SINCROFIT" ? "#24A8B4" : "#FF6633"} strokeWidth={3} dot={false} {...(activeDot ? { activeDot: { r: 5 } } : {})}/></LineChart></ResponsiveContainer>;
}
