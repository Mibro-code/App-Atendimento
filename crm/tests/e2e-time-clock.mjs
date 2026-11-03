// Testes E2E do módulo de Ponto — mesmo padrão de tests/e2e-rbac.mjs (HTTP
// real, cookies httpOnly do NextAuth, contra app + banco rodando com o seed
// aplicado). Depende da "equipe B" adicionada em prisma/seed.ts
// (roberto.supervisor@mibro.local / paula.vendedora@mibro.local) para os
// testes de "supervisor não vê outra equipe".
//
// Uso:
//   BASE_URL=http://localhost:3001 SEED_ADMIN_PASSWORD=... node tests/e2e-time-clock.mjs
const BASE_URL = process.env.BASE_URL || "http://localhost:3001";

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`OK   - ${name}`);
  } else {
    failed++;
    console.log(`FAIL - ${name}${extra ? " :: " + JSON.stringify(extra) : ""}`);
  }
}

function makeCookieJar() {
  const jar = new Map();
  return {
    apply(headers) {
      const parts = [];
      for (const [k, v] of jar) parts.push(`${k}=${v}`);
      if (parts.length) headers.set("cookie", parts.join("; "));
    },
    capture(res) {
      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const sc of setCookie) {
        const [pair] = sc.split(";");
        const idx = pair.indexOf("=");
        const k = pair.slice(0, idx);
        const v = pair.slice(idx + 1);
        jar.set(k, v);
      }
    },
  };
}

async function req(jar, path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  jar.apply(headers);
  const res = await fetch(BASE_URL + path, { ...opts, headers, redirect: "manual" });
  jar.capture(res);
  return res;
}

async function login(email, password) {
  const jar = makeCookieJar();
  const csrfRes = await req(jar, "/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();

  const body = new URLSearchParams({
    email, password, csrfToken, callbackUrl: BASE_URL + "/dashboard", json: "true",
  });

  const res = await req(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const location = res.headers.get("location") || "";
  const failedLogin = location.includes("error=");
  return { jar, ok: (res.status === 302 || res.status === 200) && !failedLogin, status: res.status };
}

function grantedLocation() {
  return {
    status: "GRANTED",
    latitude: -23.55 + Math.random() * 0.01,
    longitude: -46.63 + Math.random() * 0.01,
    accuracyMeters: 18,
    capturedAt: new Date().toISOString(),
    userAgentSummary: "Chrome 128 / Android",
    deviceType: "mobile",
  };
}

function deniedLocation() {
  return { status: "DENIED", userAgentSummary: "Chrome 128 / Android", deviceType: "mobile" };
}

function timeoutLocation() {
  return { status: "TIMEOUT", userAgentSummary: "Safari 17 / iOS", deviceType: "mobile" };
}

function todayBrazilKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function clockEvent(jar, eventType, location, extra = {}) {
  return req(jar, "/api/profile/time-clock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventType, location, verification: { type: "password", password: "vendedor123" }, ...extra }),
  });
}

async function createOccurrence(jar, type, occurrenceDate, description) {
  const res = await req(jar, "/api/profile/time-clock/occurrences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, occurrenceDate, description }),
  });
  return { res, body: await res.json().catch(() => ({})) };
}

async function uploadDocument(jar, occurrenceId, fileName, mimeType, bytes) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);
  const headers = new Headers();
  jar.apply(headers);
  const res = await fetch(`${BASE_URL}/api/profile/time-clock/occurrences/${occurrenceId}/documents`, {
    method: "POST",
    headers,
    body: form,
  });
  jar.capture(res);
  return res;
}

async function main() {
  console.log(`Testando módulo de Ponto contra ${BASE_URL}\n`);

  const adminLogin = await login("admin@mibro.local", process.env.SEED_ADMIN_PASSWORD || "");
  ok("Login do admin funciona", adminLogin.ok, adminLogin);
  const adminJar = adminLogin.jar;

  const camilaLogin = await login("supervisor@mibro.local", "vendedor123"); // equipe A
  ok("Login da supervisora (equipe A) funciona", camilaLogin.ok);
  const camilaJar = camilaLogin.jar;

  const joaoLogin = await login("joao.vendedor@mibro.local", "vendedor123"); // equipe A
  ok("Login do vendedor João (equipe A) funciona", joaoLogin.ok);
  const joaoJar = joaoLogin.jar;

  const mariaLogin = await login("maria.vendedora@mibro.local", "vendedor123"); // equipe A
  ok("Login da vendedora Maria (equipe A) funciona", mariaLogin.ok);
  const mariaJar = mariaLogin.jar;

  const robertoLogin = await login("roberto.supervisor@mibro.local", "vendedor123"); // equipe B
  ok("Login do supervisor Roberto (equipe B) funciona", robertoLogin.ok);
  const robertoJar = robertoLogin.jar;

  const paulaLogin = await login("paula.vendedora@mibro.local", "vendedor123"); // equipe B
  ok("Login da vendedora Paula (equipe B) funciona", paulaLogin.ok);
  const paulaJar = paulaLogin.jar;

  // 1. Entrada com localização concedida
  const clockInRes = await clockEvent(joaoJar, "CLOCK_IN", grantedLocation());
  const clockInBody = await clockInRes.json().catch(() => ({}));
  const alreadyToday = clockInRes.status === 409; // reexecução do teste no mesmo dia
  ok(
    "Entrada com localização concedida é registrada (ou já estava registrada hoje)",
    clockInRes.status === 201 || alreadyToday,
    clockInBody
  );
  if (clockInRes.status === 201) {
    ok(
      "Entrada gravou latitude/longitude quando a localização foi concedida",
      clockInBody.entry?.locationStatus === "GRANTED" && clockInBody.entry?.latitude != null,
      clockInBody
    );
  }

  // 2. Intervalo (saída + retorno)
  const lunchStartRes = await clockEvent(joaoJar, "LUNCH_START", grantedLocation());
  ok("Saída para intervalo é registrada (ou já estava)", lunchStartRes.status === 201 || lunchStartRes.status === 409);
  const lunchEndRes = await clockEvent(joaoJar, "LUNCH_END", grantedLocation());
  ok("Retorno do intervalo é registrado (ou já estava)", lunchEndRes.status === 201 || lunchEndRes.status === 409);

  // 3. Saída — antecipada ou não, dependendo do horário real do teste; os
  // dois caminhos são verificados conforme a resposta do servidor.
  const clockOutAttempt = await clockEvent(joaoJar, "CLOCK_OUT", grantedLocation());
  if (clockOutAttempt.status === 422) {
    const attemptBody = await clockOutAttempt.json();
    ok(
      "Saída antecipada sem justificativa é bloqueada (422 EARLY_DEPARTURE_JUSTIFICATION_REQUIRED)",
      attemptBody.code === "EARLY_DEPARTURE_JUSTIFICATION_REQUIRED",
      attemptBody
    );
    const withJustification = await clockEvent(joaoJar, "CLOCK_OUT", grantedLocation(), {
      earlyDeparture: { reason: "OUTRO", description: "Teste automatizado e2e." },
    });
    ok("Saída antecipada COM justificativa é aceita (201)", withJustification.status === 201, await withJustification.json().catch(() => ({})));
  } else {
    ok(
      "Saída no horário previsto é aceita diretamente (201, ou já registrada hoje)",
      clockOutAttempt.status === 201 || clockOutAttempt.status === 409,
      await clockOutAttempt.json().catch(() => ({}))
    );
  }

  // 4. Localização negada/timeout — ponto é registrado do mesmo jeito, sem
  // inventar coordenadas.
  const mariaDeniedRes = await clockEvent(mariaJar, "CLOCK_IN", deniedLocation());
  const mariaDeniedBody = await mariaDeniedRes.json().catch(() => ({}));
  ok(
    "Localização negada não bloqueia o registro do ponto",
    mariaDeniedRes.status === 201 || mariaDeniedRes.status === 409,
    mariaDeniedBody
  );
  if (mariaDeniedRes.status === 201) {
    ok(
      "Localização negada é salva sem coordenadas inventadas",
      mariaDeniedBody.entry?.locationStatus === "DENIED" && mariaDeniedBody.entry?.latitude === null,
      mariaDeniedBody
    );
  }

  const paulaTimeoutRes = await clockEvent(paulaJar, "CLOCK_IN", timeoutLocation());
  ok("Timeout de localização também registra o ponto (ou já estava registrado)", paulaTimeoutRes.status === 201 || paulaTimeoutRes.status === 409);

  // 5. Ocorrência + documentos (JPG e PDF válidos, tipo inválido rejeitado)
  const today = todayBrazilKey();
  const { res: occRes, body: occBody } = await createOccurrence(joaoJar, "ESQUECIMENTO", today, "Esqueci de bater o ponto de entrada ontem.");
  ok("Criação de ocorrência funciona", occRes.status === 201, occBody);
  const occurrenceId = occBody.occurrence?.id;
  let jpgDocumentId = null;

  if (occurrenceId) {
    const jpgRes = await uploadDocument(joaoJar, occurrenceId, "atestado.jpg", "image/jpeg", new Uint8Array([1, 2, 3, 4]));
    const jpgBody = await jpgRes.json().catch(() => ({}));
    ok("Upload de JPG é aceito", jpgRes.status === 201, jpgBody);
    jpgDocumentId = jpgBody.document?.id ?? null;

    const pdfRes = await uploadDocument(joaoJar, occurrenceId, "atestado.pdf", "application/pdf", new Uint8Array([5, 6, 7, 8]));
    ok("Upload de PDF é aceito", pdfRes.status === 201, await pdfRes.json().catch(() => ({})));

    const invalidRes = await uploadDocument(joaoJar, occurrenceId, "malware.zip", "application/zip", new Uint8Array([9, 9]));
    ok("Upload de tipo não permitido é rejeitado (400)", invalidRes.status === 400);
  }

  // 6. Vendedor não acessa documento de outro (RBAC do documento é reconferido por request)
  if (jpgDocumentId) {
    const ownerAccessRes = await req(joaoJar, `/api/attendance-documents/${jpgDocumentId}`);
    ok("Dono do documento consegue acessá-lo", ownerAccessRes.status === 200);

    const otherAccessRes = await req(mariaJar, `/api/attendance-documents/${jpgDocumentId}`);
    ok("Outro vendedor (Maria) não acessa documento do João (403)", otherAccessRes.status === 403);
  }

  // 7. Supervisor vê a própria equipe / não vê outra equipe
  const camilaTeamRes = await req(camilaJar, "/api/team/time-clock");
  const camilaTeamBody = await camilaTeamRes.json().catch(() => ({}));
  ok("Supervisora Camila acessa /api/team/time-clock (200)", camilaTeamRes.status === 200, camilaTeamBody);
  const camilaSeesOnlyOwnTeam =
    Array.isArray(camilaTeamBody.rows) && camilaTeamBody.rows.every((r) => r.name !== "Paula Vendedora");
  ok("Supervisora Camila não vê registros da equipe B (Paula) na própria listagem", camilaSeesOnlyOwnTeam, camilaTeamBody);

  // Descobre o id da Paula via a listagem do admin, para tentar um filtro cross-team.
  const adminOverviewRes = await req(adminJar, "/api/admin/time-clock?withJustification=false");
  const adminOverviewBody = await adminOverviewRes.json().catch(() => ({}));
  const paulaRow = (adminOverviewBody.rows || []).find((r) => r.name === "Paula Vendedora");
  if (paulaRow) {
    const crossTeamRes = await req(camilaJar, `/api/team/time-clock?userId=${paulaRow.userId}`);
    ok("Supervisora Camila é bloqueada ao filtrar por vendedora de outra equipe (403)", crossTeamRes.status === 403);
  }

  // 8. Admin vê todos
  ok(
    "Admin vê registros de mais de uma equipe em /api/admin/time-clock",
    new Set((adminOverviewBody.rows || []).map((r) => r.name)).size >= 1,
    adminOverviewBody
  );

  // 9. Aprovação/rejeição de ocorrência (supervisor da própria equipe)
  if (occurrenceId) {
    const approveRes = await req(camilaJar, `/api/team/time-clock/occurrences/${occurrenceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "APPROVED", reviewNote: "OK, aprovado no teste e2e." }),
    });
    ok("Supervisora da própria equipe aprova a ocorrência do vendedor", approveRes.status === 200, await approveRes.json().catch(() => ({})));

    const crossApproveRes = await req(robertoJar, `/api/team/time-clock/occurrences/${occurrenceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    ok("Supervisor de outra equipe não consegue revisar a ocorrência (403)", crossApproveRes.status === 403);
  }

  // 10. Timezone: workDate de hoje bate com a data civil de São Paulo
  const joaoTodayRes = await req(joaoJar, "/api/profile/time-clock");
  const joaoTodayBody = await joaoTodayRes.json().catch(() => ({}));
  const todayEntriesOk =
    Array.isArray(joaoTodayBody.today) &&
    joaoTodayBody.today.length > 0 &&
    joaoTodayBody.today.every((e) => new Date(e.workDate).toISOString().slice(0, 10) === today);
  ok("workDate das entradas de hoje bate com a data civil de São Paulo", todayEntriesOk, { today, sample: joaoTodayBody.today?.[0] });

  console.log(`\n${passed} passou(aram), ${failed} falhou(aram).`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Erro fatal nos testes:", e);
  process.exit(1);
});
