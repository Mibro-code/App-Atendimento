import { describe, expect, it } from "vitest";
import {
  canAdminDeleteUser,
  canExportCustomers,
  canExportSellerByTeamPolicy,
  canSupervisorConfigureSeller,
  canSupervisorCreateTeamUser,
  canSupervisorDeactivateTeamUser,
  canTransferByTeamPolicy,
} from "./team-rules";

const supervisor = { id: "sup-1", role: "SUPERVISOR" as const, supervisorId: null, active: true };
const sellerA = { id: "seller-a", role: "VENDEDOR" as const, supervisorId: "sup-1", active: true };
const sellerB = { id: "seller-b", role: "VENDEDOR" as const, supervisorId: "sup-1", active: true };
const sellerOther = { id: "seller-x", role: "VENDEDOR" as const, supervisorId: "sup-2", active: true };
const representative = { id: "rep-a", role: "REPRESENTANTE" as const, supervisorId: "sup-1", active: true };

describe("gestão do ciclo de vida das contas", () => {
  it("supervisor desativa somente vendedor ou representante ativo da própria equipe", () => {
    expect(canSupervisorDeactivateTeamUser("sup-1", sellerA)).toBe(true);
    expect(canSupervisorDeactivateTeamUser("sup-1", representative)).toBe(true);
    expect(canSupervisorDeactivateTeamUser("sup-1", sellerOther)).toBe(false);
    expect(canSupervisorDeactivateTeamUser("sup-1", { ...sellerA, active: false })).toBe(false);
    expect(canSupervisorDeactivateTeamUser("sup-1", supervisor)).toBe(false);
  });

  it("somente admin exclui outra conta sem subordinados", () => {
    const admin = { id: "admin-1", role: "ADMIN" as const };
    expect(canAdminDeleteUser(admin, "seller-a", 0)).toBe(true);
    expect(canAdminDeleteUser(admin, "admin-1", 0)).toBe(false);
    expect(canAdminDeleteUser(admin, "sup-1", 2)).toBe(false);
    expect(canAdminDeleteUser(supervisor, "seller-a", 0)).toBe(false);
  });
});

describe("regras de equipe", () => {
  it("supervisor configura dias diferentes apenas para vendedores da própria equipe", () => {
    expect(canSupervisorConfigureSeller(supervisor.id, sellerA)).toBe(true);
    expect(canSupervisorConfigureSeller(supervisor.id, sellerOther)).toBe(false);
    expect(canSupervisorConfigureSeller(supervisor.id, representative)).toBe(true);
  });

  it("supervisor liberado cria somente vendedor ou representante", () => {
    const allowedSupervisor = { ...supervisor, canCreateTeamUsers: true };
    expect(canSupervisorCreateTeamUser(allowedSupervisor, "VENDEDOR")).toBe(true);
    expect(canSupervisorCreateTeamUser(allowedSupervisor, "REPRESENTANTE")).toBe(true);
    expect(canSupervisorCreateTeamUser(allowedSupervisor, "SUPERVISOR")).toBe(false);
    expect(canSupervisorCreateTeamUser(allowedSupervisor, "ADMIN")).toBe(false);
    expect(canSupervisorCreateTeamUser({ ...allowedSupervisor, canCreateTeamUsers: false }, "VENDEDOR")).toBe(false);
  });

  it("representante segue as mesmas regras comerciais de repasse do vendedor", () => {
    expect(canTransferByTeamPolicy({ actor: representative, source: representative, target: sellerA, sellerTransfersEnabled: true, sellerTransferIndividuallyEnabled: true })).toBe(true);
    expect(canTransferByTeamPolicy({ actor: representative, source: representative, target: sellerOther, sellerTransfersEnabled: true, sellerTransferIndividuallyEnabled: true })).toBe(false);
  });

  it("bloqueia repasse por vendedor quando a política está desabilitada", () => {
    expect(
      canTransferByTeamPolicy({ actor: sellerA, source: sellerA, target: sellerB, sellerTransfersEnabled: false })
    ).toBe(false);
  });

  it("permite repasse entre vendedores da mesma equipe quando habilitado", () => {
    expect(
      canTransferByTeamPolicy({ actor: sellerA, source: sellerA, target: sellerB, sellerTransfersEnabled: true, sellerTransferIndividuallyEnabled: true })
    ).toBe(true);
  });

  it("bloqueia o vendedor sem permissão individual mesmo com a equipe habilitada", () => {
    expect(
      canTransferByTeamPolicy({ actor: sellerA, source: sellerA, target: sellerB, sellerTransfersEnabled: true, sellerTransferIndividuallyEnabled: false })
    ).toBe(false);
  });

  it("supervisor repassa clientes somente dentro da própria equipe", () => {
    expect(
      canTransferByTeamPolicy({ actor: supervisor, source: sellerA, target: sellerB, sellerTransfersEnabled: false })
    ).toBe(true);
    expect(
      canTransferByTeamPolicy({ actor: supervisor, source: sellerA, target: sellerOther, sellerTransfersEnabled: true })
    ).toBe(false);
  });

  it("nunca permite repasse entre equipes para vendedor ou supervisor", () => {
    expect(
      canTransferByTeamPolicy({ actor: sellerA, source: sellerA, target: sellerOther, sellerTransfersEnabled: true })
    ).toBe(false);
    expect(
      canTransferByTeamPolicy({ actor: supervisor, source: sellerA, target: sellerOther, sellerTransfersEnabled: true })
    ).toBe(false);
  });

  it("supervisor exporta somente a própria equipe e vendedor somente a própria carteira", () => {
    expect(canExportSellerByTeamPolicy(supervisor, sellerA)).toBe(true);
    expect(canExportSellerByTeamPolicy(supervisor, sellerOther)).toBe(false);
    expect(canExportSellerByTeamPolicy(sellerA, sellerA)).toBe(true);
    expect(canExportSellerByTeamPolicy(sellerA, sellerB)).toBe(false);
  });
});

describe("exportação de clientes (RBAC)", () => {
  it("vendedor e representante não exportam", () => {
    expect(canExportCustomers("VENDEDOR")).toBe(false);
    expect(canExportCustomers("REPRESENTANTE")).toBe(false);
  });
  it("supervisor e admin exportam", () => {
    expect(canExportCustomers("SUPERVISOR")).toBe(true);
    expect(canExportCustomers("ADMIN")).toBe(true);
  });
});
