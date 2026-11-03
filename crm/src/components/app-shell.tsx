"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { Role } from "@prisma/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { useEffect, useState } from "react";
import { CalendarIcon } from "@/components/agenda/agenda-ui";
import { AgendaReminders } from "@/components/agenda/agenda-reminders";
import { QuoteAlerts } from "@/components/quote-alerts";

interface NavItem {
  href: string;
  label: string;
  adminOnly?: boolean;
  roles?: Role[];
  icon?: "calendar";
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Painel" },
  { href: "/clientes", label: "Clientes" },
  { href: "/follow-ups", label: "Follow-up de recompra" },
  { href: "/cotacoes/nova", label: "Nova cotação" },
  { href: "/cotacoes", label: "Propostas" },
  { href: "/tabela-precos", label: "Minha tabela de preços", roles: ["REPRESENTANTE"] },
  { href: "/vendas", label: "Vendas" },
  { href: "/metas", label: "Metas", roles: ["ADMIN", "SUPERVISOR", "VENDEDOR"] },
  { href: "/ponto", label: "Ponto", roles: ["VENDEDOR", "SUPERVISOR"] },
  { href: "/perfil", label: "Meu perfil" },
  { href: "/equipe", label: "Minha equipe", roles: ["SUPERVISOR"] },
  { href: "/equipe/ponto", label: "Jornada da equipe", roles: ["SUPERVISOR"] },
  { href: "/gestao-comercial/precos", label: "Gestão comercial", roles: ["ADMIN", "SUPERVISOR"] },
  { href: "/admin", label: "Administração", adminOnly: true },
  { href: "/admin/mapa", label: "Mapa comercial", adminOnly: true },
  { href: "/admin/ponto", label: "Ponto — equipes", adminOnly: true },
  { href: "/atividades", label: "Central de Atividades" },
  // Agenda é sempre a última opção principal do menu.
  { href: "/agenda", label: "Agenda", icon: "calendar" },
];

export function AppShell({
  children,
  userName,
  userRole,
  agendaBadge = 0,
  attendanceUrl,
  proposalsEnabled = false,
}: {
  children: React.ReactNode;
  userName: string;
  userRole: Role;
  /** Compromissos pendentes de hoje do próprio usuário (0 = sem badge). */
  agendaBadge?: number;
  attendanceUrl?: string;
  /** Módulo de propostas comerciais Olist ativo (CRM_PROPOSALS_OLIST_ENABLED). */
  proposalsEnabled?: boolean;
}) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const messaging:NavItem[]=attendanceUrl?[{href:'/envios-whatsapp',label:'WhatsApp · selecionar contatos'},{href:'/central-center?mode=search',label:'Busca integrada'},{href:'/central-center?mode=notifications',label:'Avisos integrados'}]:[];
  const navItems = proposalsEnabled
    ? NAV_ITEMS.flatMap((item) =>
        item.href === "/cotacoes"
          ? [{ href: "/propostas", label: "Propostas comerciais" }, { ...item, label: "Cotações e simulações" }]
          : item.href === "/admin"
            ? [item, { href: "/admin/propostas", label: "Propostas — configuração", adminOnly: true }]
            : [item]
      )
    : NAV_ITEMS;
  const items = [...navItems.slice(0,2),...messaging,...navItems.slice(2)].filter(
    (item) => (!item.adminOnly || userRole === "ADMIN") && (!item.roles || item.roles.includes(userRole))
  );
  const mobileShortcuts = items.filter((item) =>
    ["/dashboard", "/clientes", proposalsEnabled ? "/propostas" : "/cotacoes", "/vendas"].includes(item.href)
  );

  useEffect(() => setMobileMenuOpen(false), [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileMenuOpen]);

  function isActive(href: string) {
    if (pathname === href) return true;
    if (href === "/admin" || !pathname.startsWith(href + "/")) return false;
    // Um item mais específico do menu (ex.: /cotacoes/nova) tem prioridade.
    return !items.some((other) => other.href !== href && other.href.startsWith(href + "/") && (pathname === other.href || pathname.startsWith(other.href + "/")));
  }

  return (
    <div className="crm-app-shell min-h-screen flex">
      {/* Sidebar desktop */}
      <aside className="crm-sidebar hidden md:flex md:flex-col md:w-60 md:shrink-0 border-r border-gray-200 bg-white">
        <div className="h-16 flex items-center px-5 border-b border-gray-200">
          <span className="font-semibold text-gray-900 text-lg">Central <span className="crm-module-label">Comercial</span></span>
        </div>
        <nav className="crm-primary-nav flex-1 px-3 py-4 space-y-1" aria-label="Navegação comercial">
          {attendanceUrl && <a href={attendanceUrl} target="_top" className="flex rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 mb-3">← Atendimento</a>}
          {items.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active?'page':undefined}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <NavLabel item={item} badge={agendaBadge} />
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-gray-200">
          <ThemeToggle />
          <p className="text-xs text-gray-500 px-2 mb-2">
            {userName} · {roleLabel(userRole)}
          </p>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-secondary w-full text-sm"
          >
            Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="crm-workspace-header hidden md:flex"><div><span className="crm-module-label">Central de atendimento · CRM</span><h1>{items.find(item=>isActive(item.href))?.label||'Portal Comercial'}</h1></div><span className="crm-account-label">{userName} · {roleLabel(userRole)}</span></header>
        {/* Topbar mobile */}
        <header className="md:hidden h-14 flex items-center justify-between px-4 border-b border-gray-200 bg-white sticky top-0 z-10">
          <span className="font-semibold text-gray-900">Central · Comercial</span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
          >
            <span className="flex w-4 flex-col gap-1" aria-hidden>
              <span className="h-0.5 w-full bg-current" />
              <span className="h-0.5 w-full bg-current" />
              <span className="h-0.5 w-full bg-current" />
            </span>
            Menu
          </button>
        </header>

        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 bg-black/45" onClick={() => setMobileMenuOpen(false)}>
            <aside
              id="mobile-navigation"
              className="absolute inset-y-0 right-0 flex w-[min(88vw,22rem)] flex-col bg-white shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-label="Menu principal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-16 items-center justify-between border-b border-gray-200 px-4">
                <div>
                  <p className="font-semibold text-gray-900">Navegação</p>
                  <p className="text-xs text-gray-500">{userName} · {roleLabel(userRole)}</p>
                </div>
                <button type="button" className="rounded-md px-3 py-2 text-sm font-medium text-gray-500" onClick={() => setMobileMenuOpen(false)} aria-label="Fechar menu">Fechar</button>
              </div>
              <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                {attendanceUrl && <a href={attendanceUrl} target="_top" className="flex rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 mb-3">← Atendimento</a>}
                {items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link key={item.href} href={item.href} aria-current={active?'page':undefined} className={`flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium ${active ? "bg-brand-100 text-brand-800" : "text-gray-700 hover:bg-gray-100"}`}>
                      <NavLabel item={item} badge={agendaBadge} />
                    </Link>
                  );
                })}
              </nav>
              <div className="space-y-2 border-t border-gray-200 p-4">
                <ThemeToggle />
                <button onClick={() => signOut({ callbackUrl: "/login" })} className="btn-secondary w-full">Sair da conta</button>
              </div>
            </aside>
          </div>
        )}

        <main className="crm-workspace-main flex-1 p-4 md:p-8 pb-20 md:pb-8">{children}</main>
        <AgendaReminders />
        {userRole === "SUPERVISOR" && <QuoteAlerts />}

        {/* Bottom nav mobile */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around z-10">
          {mobileShortcuts.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 text-center py-2 text-xs font-medium ${
                  active ? "text-brand" : "text-gray-500"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className={`flex-1 py-2 text-center text-xs font-medium ${mobileMenuOpen ? "text-brand" : "text-gray-500"}`}
          >
            Menu
            {agendaBadge > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#FF6633] align-middle" aria-label="Compromissos pendentes hoje" />}
          </button>
        </nav>
      </div>
    </div>
  );
}

function NavLabel({ item, badge }: { item: NavItem; badge: number }) {
  return (
    <>
      {item.icon === "calendar" && <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />}
      <span className="flex-1">{item.label}</span>
      {item.href === "/agenda" && badge > 0 && (
        <span className="rounded-full bg-[#FF6633] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white" aria-label={`${badge} compromisso(s) pendente(s) hoje`}>
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </>
  );
}

function roleLabel(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "Administrador";
    case "SUPERVISOR":
      return "Supervisor";
    case "VENDEDOR":
      return "Vendedor";
    case "REPRESENTANTE":
      return "Representante";
    default:
      return role;
  }
}
