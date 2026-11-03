import { describe, expect, it } from "vitest";
import { canView, decide, proposalScope, type ProposalActor, type ProposalFacts, type DecideOptions } from "./proposal-permissions";

const now = new Date("2026-10-30T12:00:00Z");
const opts: DecideOptions = { now, limits: { seller: 0, supervisor: 500, manager: null }, conversionMode: "api" };

const seller: ProposalActor = { id: "s1", role: "VENDEDOR", functions: [], teamSellerIds: [] };
const otherSeller: ProposalActor = { id: "s2", role: "VENDEDOR", functions: [], teamSellerIds: [] };
const supervisor: ProposalActor = { id: "sup", role: "SUPERVISOR", functions: [], teamSellerIds: ["sup", "s1"] };
const otherSupervisor: ProposalActor = { id: "sup2", role: "SUPERVISOR", functions: [], teamSellerIds: ["sup2", "s9"] };
const manager: ProposalActor = { id: "g", role: "VENDEDOR", functions: ["GERENTE_COMERCIAL"], teamSellerIds: [] };
const finance: ProposalActor = { id: "f", role: "VENDEDOR", functions: ["FINANCEIRO"], teamSellerIds: [] };
const admin: ProposalActor = { id: "a", role: "ADMIN", functions: [], teamSellerIds: [] };

const facts = (over: Partial<ProposalFacts> = {}): ProposalFacts => ({
  sellerId: "s1",
  commercialStatus: "RASCUNHO",
  approvalStatus: "NAO_SOLICITADA",
  acceptanceStatus: "PENDENTE",
  syncStatus: "SINCRONIZADA",
  orderStatus: "SEM_PEDIDO",
  version: 1,
  syncedVersion: 1,
  approvedVersion: null,
  approvedHash: null,
  materialHash: "h1",
  acceptedVersion: null,
  validUntil: new Date("2026-11-30T00:00:00Z"),
  olistProposalId: "900",
  lastEditorId: "s1",
  discountBps: 0,
  dispatchedCurrentVersion: false,
  sellerLinked: true,
  olistConcluded: false,
  ...over,
});
const approved = (over: Partial<ProposalFacts> = {}) =>
  facts({ commercialStatus: "APROVADA_INTERNAMENTE", approvalStatus: "APROVADA", approvedVersion: 1, approvedHash: "h1", ...over });
const accepted = (over: Partial<ProposalFacts> = {}) =>
  approved({ commercialStatus: "ACEITA", acceptanceStatus: "ACEITA", acceptedVersion: 1, dispatchedCurrentVersion: true, ...over });

describe("aprovação de pedido exclusiva do Master", () => {
  const order = () => accepted({ commercialStatus: "CONVERTIDA", orderStatus: "PEDIDO_CRIADO" });
  it.each([seller, supervisor, manager, finance, { ...seller, role: "REPRESENTANTE" as const }])("bloqueia $role mesmo com função adicional", (actor) => {
    expect(decide("approve_order", actor, order(), opts).allowed).toBe(false);
  });
  it("permite Master no pedido criado, inclusive quando ele é o vendedor", () => {
    expect(decide("approve_order", admin, order(), opts).allowed).toBe(true);
    expect(decide("approve_order", { ...admin, id: "s1" }, order(), opts).allowed).toBe(true);
  });
  it.each(["SEM_PEDIDO", "CONVERSAO_INCERTA", "CONVERSAO_EM_ANDAMENTO", "CANCELADO", "PEDIDO_APROVADO", "ENTREGUE"] as const)("bloqueia %s", (orderStatus) => {
    expect(decide("approve_order", admin, accepted({ commercialStatus: "CONVERTIDA", orderStatus }), opts).allowed).toBe(false);
  });
});

describe("visibilidade e escopo", () => {
  it("vendedor não visualiza proposta de outro vendedor (3)", () => {
    expect(canView(seller, facts())).toBe(true);
    expect(canView(otherSeller, facts())).toBe(false);
    expect(decide("view", otherSeller, facts(), opts)).toEqual({ allowed: false, reason: "Você não tem acesso a esta proposta." });
  });

  it("supervisor visualiza a equipe e não outras equipes (4, 5)", () => {
    expect(canView(supervisor, facts())).toBe(true);
    expect(canView(otherSupervisor, facts())).toBe(false);
    expect(proposalScope(supervisor)).toMatchObject({ all: false, sellerIds: ["sup", "s1"] });
  });

  it("gerente e admin veem tudo; financeiro só aprovadas em diante", () => {
    expect(proposalScope(manager).all).toBe(true);
    expect(proposalScope(admin).all).toBe(true);
    expect(canView(finance, facts())).toBe(false);
    expect(canView(finance, approved())).toBe(true);
  });
});

describe("aprovação", () => {
  const pending = facts({ commercialStatus: "AGUARDANDO_APROVACAO", approvalStatus: "PENDENTE" });

  it("vendedor solicita aprovação de rascunho sincronizado (6)", () => {
    expect(decide("submit", seller, facts(), opts).allowed).toBe(true);
    expect(decide("submit", seller, facts({ syncedVersion: null, syncStatus: "ERRO" }), opts).reason).toMatch(/Sincronize/);
    expect(decide("submit", seller, facts({ sellerLinked: false }), opts).reason).toMatch(/vínculo/);
  });

  it("supervisor aprova e reprova; ninguém aprova a própria proposta (7, 8)", () => {
    expect(decide("approve", supervisor, pending, opts).allowed).toBe(true);
    expect(decide("reject", supervisor, pending, opts).allowed).toBe(true);
    expect(decide("approve", seller, pending, opts).reason).toBe("Você não pode aprovar sua própria proposta.");
    expect(decide("approve", supervisor, { ...pending, lastEditorId: "sup" }, opts).reason).toBe("Você não pode aprovar sua própria proposta.");
    expect(decide("approve", otherSupervisor, pending, opts).allowed).toBe(false);
  });

  it("supervisor aprova só dentro da alçada", () => {
    const high = { ...pending, discountBps: 900 };
    expect(decide("approve", supervisor, high, opts).reason).toMatch(/acima da alçada do supervisor/);
    expect(decide("approve", manager, high, opts).allowed).toBe(true);
    const capped = { ...opts, limits: { seller: 0, supervisor: 500, manager: 800 } };
    expect(decide("approve", manager, high, capped).reason).toMatch(/administrador/);
    expect(decide("approve", admin, high, capped).allowed).toBe(true);
  });
});

describe("envio e aceite", () => {
  it("proposta aprovada pode ser enviada; pendente não (10, 11)", () => {
    expect(decide("send_email", seller, approved(), opts).allowed).toBe(true);
    const pending = facts({ commercialStatus: "AGUARDANDO_APROVACAO", approvalStatus: "PENDENTE" });
    expect(decide("send_email", seller, pending, opts).reason).toBe("Esta proposta precisa de aprovação antes do envio.");
  });

  it("alteração material invalida a aprovação (9)", () => {
    const changed = approved({ commercialStatus: "ENVIADA", version: 2, syncedVersion: 2, materialHash: "h2" });
    expect(decide("send_email", seller, changed, opts).reason).toBe("A proposta foi alterada e precisa de nova aprovação.");
  });

  it("aceite exige envio registrado da versão atual (14)", () => {
    const sent = approved({ commercialStatus: "ENVIADA" });
    expect(decide("register_acceptance", seller, sent, opts).reason).toMatch(/envio desta versão/);
    expect(decide("register_acceptance", seller, { ...sent, dispatchedCurrentVersion: true }, opts).allowed).toBe(true);
    expect(decide("register_change_request", seller, sent, opts).allowed).toBe(true);
  });

  it("proposta aceita não é alterada silenciosamente", () => {
    expect(decide("edit", seller, accepted(), opts).reason).toMatch(/Reabra a negociação/);
    expect(decide("reopen", seller, accepted(), opts).allowed).toBe(true);
  });

  it("financeiro não altera condições comerciais", () => {
    expect(decide("edit", finance, approved(), opts).reason).toBe("O Financeiro não altera condições comerciais.");
    expect(decide("send_email", finance, approved(), opts).allowed).toBe(false);
  });
});

describe("conversão", () => {
  it("expirada não converte (15)", () => {
    const expired = accepted({ validUntil: new Date("2026-10-01T00:00:00Z") });
    expect(decide("convert", supervisor, expired, opts).reason).toMatch(/expirou/);
    expect(decide("request_conversion", seller, expired, opts).reason).toMatch(/expirou/);
  });

  it("sem aceite é bloqueada (16)", () => {
    expect(decide("convert", supervisor, approved({ commercialStatus: "ENVIADA" }), opts).reason).toBe("O cliente ainda não aceitou a versão atual.");
    expect(decide("convert", supervisor, accepted({ version: 2, syncedVersion: 2 }), opts).reason).toBe("O cliente ainda não aceitou a versão atual.");
  });

  it("sem permissão é bloqueada; vendedor só solicita (17)", () => {
    expect(decide("convert", seller, accepted(), opts).reason).toMatch(/Somente supervisor/);
    expect(decide("convert", finance, accepted(), opts).allowed).toBe(false);
    expect(decide("request_conversion", seller, accepted(), opts).allowed).toBe(true);
    expect(decide("convert", supervisor, accepted(), opts).allowed).toBe(true);
    expect(decide("convert", manager, accepted({ commercialStatus: "CONVERSAO_SOLICITADA" }), opts).allowed).toBe(true);
  });

  it("não converte duas vezes nem com conversão incerta", () => {
    expect(decide("convert", admin, accepted({ orderStatus: "PEDIDO_CRIADO" }), opts).reason).toBe("A conversão já foi realizada.");
    expect(decide("convert", admin, accepted({ orderStatus: "CONVERSAO_INCERTA" }), opts).reason).toMatch(/vincule o pedido/);
    expect(decide("reconcile_order", admin, accepted({ orderStatus: "CONVERSAO_INCERTA" }), opts).allowed).toBe(true);
    expect(decide("convert", admin, accepted({ olistConcluded: true }), opts).reason).toMatch(/concluída/);
  });

  it("modo manual bloqueia a chamada automática", () => {
    expect(decide("convert", admin, accepted(), { ...opts, conversionMode: "manual" }).reason).toMatch(/desativada/);
    expect(decide("reconcile_order", admin, accepted(), { ...opts, conversionMode: "manual" }).allowed).toBe(true);
  });

  it("proposta convertida não é mais reenviada ao Olist", () => {
    const converted = accepted({ commercialStatus: "CONVERTIDA", orderStatus: "PEDIDO_CRIADO" });
    expect(decide("sync", admin, converted, opts).allowed).toBe(false);
    expect(decide("resolve_conflict", admin, { ...converted, syncStatus: "CONFLITO" }, opts).allowed).toBe(false);
  });

  it("conflito com o Olist bloqueia a conversão", () => {
    expect(decide("convert", admin, accepted({ syncStatus: "CONFLITO" }), opts).reason).toMatch(/alterada no Olist/);
  });
});

describe("financeiro", () => {
  it("vendedor não confirma recebimento; financeiro pode conferir (24, 25)", () => {
    const converted = accepted({ commercialStatus: "CONVERTIDA", orderStatus: "PEDIDO_APROVADO" });
    expect(decide("finance_review", seller, converted, opts).allowed).toBe(false);
    expect(decide("finance_review", finance, converted, opts).allowed).toBe(true);
    expect(decide("view_financial_values", seller, converted, opts).allowed).toBe(false);
    expect(decide("view_financial_values", finance, converted, opts).allowed).toBe(true);
  });
});

describe("transferência", () => {
  it("vendedor não transfere; supervisor transfere na equipe", () => {
    expect(decide("transfer", seller, facts(), opts).allowed).toBe(false);
    expect(decide("transfer", supervisor, facts(), opts).allowed).toBe(true);
    expect(decide("transfer", otherSupervisor, facts(), opts).allowed).toBe(false);
  });
});
