import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "admin@mibrobrasil.com.br")
    .trim()
    .toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD deve ter ao menos 12 caracteres em produção.");
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log(`Administrador de produção já existe: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      name: "Administrador Mibro",
      email,
      role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

  console.log(`Administrador de produção criado: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
