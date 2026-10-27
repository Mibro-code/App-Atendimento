import NextAuth from 'next-auth';
import authConfig from '@/auth.config';
import { NextResponse } from "next/server";

// "/api/integrations/shopify" não usa sessão do NextAuth: é autenticado por
// segredo compartilhado dentro da própria rota (ver
// src/lib/api-auth.ts#requireSharedSecret), chamado pelo app Shopify
// (sistema externo, sem cookie de sessão do CRM).
// "/api/integrations/olist" idem: chamado pelo sincronizador de aprovações do
// app Shopify, autenticado na rota por requireShopifyBrand (segredo da marca).
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/central", "/api/health", "/api/integrations/shopify", "/api/integrations/olist"];

export default NextAuth(authConfig).auth((req) => {
  const { pathname } = req.nextUrl;
  // Behind a proxy (and in Next dev), nextUrl may contain an internal host.
  // Identity navigation must stay on the explicitly configured public origin.
  const publicOrigin=process.env.CENTRAL_IDENTITY_ENABLED==='true' ? new URL(process.env.CRM_PUBLIC_URL!).origin : req.nextUrl.origin;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  if (isPublic) return NextResponse.next();

  const isLoggedIn = !!req.auth?.user;

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", publicOrigin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Guarda de rota para área administrativa: nunca confiar só no frontend.
  if (pathname.startsWith("/admin") && req.auth?.user.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", publicOrigin));
  }

  // Gestão Comercial: admin edita, supervisor consulta. Layout sozinho não
  // basta — no App Router a página renderiza em paralelo ao layout.
  const role = req.auth?.user.role;
  if (pathname.startsWith("/gestao-comercial") && role !== "ADMIN" && role !== "SUPERVISOR") {
    return NextResponse.redirect(new URL("/dashboard", publicOrigin));
  }
  // Tabela exclusiva de representantes (somente consulta).
  if (pathname.startsWith("/tabela-precos") && role !== "REPRESENTANTE") {
    return NextResponse.redirect(new URL("/dashboard", publicOrigin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
