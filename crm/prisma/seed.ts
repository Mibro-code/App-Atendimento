import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error(
      "SEED_ADMIN_PASSWORD não definida. Defina essa variável de ambiente (apenas para " +
        "desenvolvimento) antes de rodar o seed. Nunca use uma senha fixa no código."
    );
  }
  if (adminPassword.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD deve ter ao menos 8 caracteres.");
  }

  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

  // Admin: só identidade/autenticação. Um ADMIN puramente administrativo
  // pode não ter SellerProfile — de propósito não criamos um aqui, para
  // exercitar esse caso já no ambiente de desenvolvimento (nenhuma tela deve
  // quebrar por causa disso).
  const admin = await prisma.user.upsert({
    where: { email: "admin@mibro.local" },
    update: {},
    create: {
      name: "Administrador Mibro",
      email: "admin@mibro.local",
      role: "ADMIN",
      passwordHash: adminPasswordHash,
    },
  });

  // Vendedores de teste — senha padrão de desenvolvimento "vendedor123"
  // (hash gerado abaixo). Documentado no README; trocar em produção.
  const sellerPasswordHash = await bcrypt.hash("vendedor123", 12);

  const supervisor = await prisma.user.upsert({
    where: { email: "supervisor@mibro.local" },
    update: {},
    create: {
      name: "Camila Supervisora",
      email: "supervisor@mibro.local",
      role: "SUPERVISOR",
      passwordHash: sellerPasswordHash,
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: supervisor.id },
    update: {},
    create: {
      userId: supervisor.id,
      displayName: "Camila Supervisora",
      jobTitle: "Supervisora comercial",
      phone: "11988880001",
      whatsapp: "11988880001",
      commercialEmail: "camila.supervisora@mibro.local",
      emailSenderName: "Camila Supervisora — Mibro",
      emailReplyTo: "camila.supervisora@mibro.local",
      region: "Sudeste",
    },
  });

  const seller1 = await prisma.user.upsert({
    where: { email: "joao.vendedor@mibro.local" },
    update: {},
    create: {
      name: "João Vendedor",
      email: "joao.vendedor@mibro.local",
      role: "VENDEDOR",
      passwordHash: sellerPasswordHash,
      supervisorId: supervisor.id,
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: seller1.id },
    update: {},
    create: {
      userId: seller1.id,
      displayName: "João Vendedor",
      jobTitle: "Consultor Comercial",
      phone: "11988880002",
      whatsapp: "11988880002",
      commercialEmail: "joao.vendedor@mibro.local",
      emailSenderName: "João Vendedor — Mibro",
      emailReplyTo: "joao.vendedor@mibro.local",
      monthlyGoalCents: 5_000_000,
      region: "Sudeste",
    },
  });

  const seller2 = await prisma.user.upsert({
    where: { email: "maria.vendedora@mibro.local" },
    update: {},
    create: {
      name: "Maria Vendedora",
      email: "maria.vendedora@mibro.local",
      role: "VENDEDOR",
      passwordHash: sellerPasswordHash,
      supervisorId: supervisor.id,
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: seller2.id },
    update: {},
    create: {
      userId: seller2.id,
      displayName: "Maria Vendedora",
      jobTitle: "Consultora Comercial",
      phone: "41988880003",
      whatsapp: "41988880003",
      commercialEmail: "maria.vendedora@mibro.local",
      emailSenderName: "Maria Vendedora — Mibro",
      emailReplyTo: "maria.vendedora@mibro.local",
      monthlyGoalCents: 4_000_000,
      region: "Sul",
    },
  });

  // "Equipe B" — segundo supervisor + vendedor, sem nenhuma relação com a
  // equipe da Camila (seller1/seller2). Existe só para os testes e2e de
  // ponto conseguirem verificar "supervisor não vê outra equipe" (não havia
  // uma segunda equipe no seed antes disso). Upsert como o resto do arquivo
  // — nunca sobrescreve/apaga o que já existia.
  const supervisorB = await prisma.user.upsert({
    where: { email: "roberto.supervisor@mibro.local" },
    update: {},
    create: {
      name: "Roberto Supervisor",
      email: "roberto.supervisor@mibro.local",
      role: "SUPERVISOR",
      passwordHash: sellerPasswordHash,
    },
  });
  const sellerB = await prisma.user.upsert({
    where: { email: "paula.vendedora@mibro.local" },
    update: {},
    create: {
      name: "Paula Vendedora",
      email: "paula.vendedora@mibro.local",
      role: "VENDEDOR",
      passwordHash: sellerPasswordHash,
      supervisorId: supervisorB.id,
    },
  });
  await prisma.sellerProfile.upsert({
    where: { userId: sellerB.id },
    update: {},
    create: {
      userId: sellerB.id,
      displayName: "Paula Vendedora",
      jobTitle: "Consultora Comercial",
      commercialEmail: "paula.vendedora@mibro.local",
      region: "Nordeste",
    },
  });

  const sellers = [seller1, seller2];
  const statuses = ["NOVO", "CONTATO_REALIZADO", "EM_NEGOCIACAO", "CLIENTE_ATIVO", "SEM_INTERESSE"] as const;
  const temperatures = ["QUENTE", "MORNO", "FRIO", "SEM_CLASSIFICACAO"] as const;

  const existingCustomers = await prisma.customer.count();
  if (existingCustomers === 0) {
    for (let i = 0; i < 12; i++) {
      const seller = sellers[i % sellers.length];
      const daysAgo = i * 7;
      const lastInteractionAt = new Date();
      lastInteractionAt.setDate(lastInteractionAt.getDate() - daysAgo);

      const customer = await prisma.customer.create({
        data: {
          contactName: `Contato Exemplo ${i + 1}`,
          tradeName: `Empresa Exemplo ${i + 1}`,
          legalName: `Empresa Exemplo ${i + 1} LTDA`,
          cnpjDigits: `1100000000${String(i).padStart(4, "0")}`.slice(0, 14),
          email: `cliente${i + 1}@exemplo.com.br`,
          phoneDigits: `1199999${String(1000 + i)}`,
          city: i % 2 === 0 ? "São Paulo" : "Curitiba",
          state: i % 2 === 0 ? "SP" : "PR",
          leadOrigin: i % 3 === 0 ? "Indicação" : "Site",
          sellerId: seller.id,
          status: statuses[i % statuses.length],
          temperature: temperatures[i % temperatures.length],
          lastInteractionAt,
        },
      });

      await prisma.customerStatusHistory.create({
        data: {
          customerId: customer.id,
          field: "STATUS",
          oldValue: null,
          newValue: customer.status,
          changedById: seller.id,
        },
      });

      await prisma.customerActivity.create({
        data: {
          customerId: customer.id,
          sellerId: seller.id,
          type: "WHATSAPP",
          description: "Primeiro contato realizado via WhatsApp.",
        },
      });

      // A maioria dos clientes de exemplo ganha uma visita presencial
      // registrada (com captura de localização concedida), para o mapa
      // comercial do admin (/admin/mapa) já ter dados reais dos dois
      // vendedores em ambiente de desenvolvimento. Coordenadas aproximadas
      // de São Paulo/SP e Curitiba/PR, com um pequeno jitter para não
      // sobrepor os marcadores. (Não usar "i % 2" aqui de novo: já é o
      // critério usado para escolher o vendedor logo acima, e repeti-lo
      // faria só um dos dois vendedores nunca ganhar visita de exemplo.)
      if (i % 3 !== 2) {
        const baseLat = customer.state === "SP" ? -23.5505 : -25.4284;
        const baseLng = customer.state === "SP" ? -46.6333 : -49.2733;
        const jitter = (i - 6) * 0.01;

        const visitActivity = await prisma.customerActivity.create({
          data: {
            customerId: customer.id,
            sellerId: seller.id,
            type: "VISITA",
            description: "Visita presencial registrada (dado de exemplo do seed).",
            latitude: baseLat + jitter,
            longitude: baseLng + jitter,
            accuracyMeters: 25,
          },
        });

        await prisma.locationCapture.create({
          data: {
            sellerId: seller.id,
            customerId: customer.id,
            activityId: visitActivity.id,
            latitude: baseLat + jitter,
            longitude: baseLng + jitter,
            accuracyMeters: 25,
            capturedAt: visitActivity.createdAt,
            locationStatus: "GRANTED",
            locationSource: "CUSTOMER_VISIT",
            userAgentSummary: "Chrome 128 / Android",
            deviceType: "mobile",
          },
        });
      }
    }

    // Uma venda confirmada de exemplo para dar dado ao dashboard.
    const firstCustomer = await prisma.customer.findFirst({ where: { sellerId: seller1.id } });
    if (firstCustomer) {
      const quote = await prisma.quote.create({
        data: {
          customerId: firstCustomer.id,
          sellerId: seller1.id,
          status: "CALCULADA",
          totalValueCents: 250_000,
        },
      });
      await prisma.sale.create({
        data: {
          customerId: firstCustomer.id,
          sellerId: seller1.id,
          stage: "PAGAMENTO_CONFIRMADO",
          valueCents: 250_000,
          confirmedAt: new Date(),
        },
      });
      void quote;
      await prisma.customer.update({
        where: { id: firstCustomer.id },
        data: { totalSoldCents: { increment: 250_000 }, lastSaleAt: new Date(), status: "CLIENTE_ATIVO" },
      });
    }
  }

  console.log("Seed concluído.");
  console.log(`Admin: ${admin.email}`);
  console.log(`Supervisor: ${supervisor.email} (senha: vendedor123)`);
  console.log(`Vendedores: ${seller1.email}, ${seller2.email} (senha: vendedor123)`);
  console.log(`Equipe B — Supervisor: ${supervisorB.email}, Vendedor: ${sellerB.email} (senha: vendedor123)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
