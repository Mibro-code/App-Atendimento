const form = document.querySelector("#auth-form");
const errorBox = document.querySelector("#error");
let setupRequired = false;

async function request(path, options) {
  const response = await fetch(path, { headers: { "Content-Type":"application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

async function initialize() {
  const status = await request("/api/auth/status");
  if (status.authenticated) return location.replace("/");
  setupRequired = status.setupRequired;
  if (setupRequired) {
    document.querySelector("#eyebrow").textContent = "PRIMEIRO ACESSO";
    document.querySelector("#title").textContent = "Crie seu acesso";
    document.querySelector("#description").textContent = "Este será o único usuário da central por enquanto.";
    document.querySelector("#name-field").hidden = false;
    document.querySelector("#name").required = true;
    document.querySelector("#password").autocomplete = "new-password";
    document.querySelector("#submit").textContent = "Criar acesso";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); errorBox.textContent = ""; const button = document.querySelector("#submit"); button.disabled = true;
  const body = { email: document.querySelector("#email").value, password: document.querySelector("#password").value };
  if (setupRequired) body.name = document.querySelector("#name").value;
  try { await request(setupRequired ? "/api/auth/setup" : "/api/auth/login", { method:"POST", body:JSON.stringify(body) }); location.replace("/"); }
  catch (error) { errorBox.textContent = error.message; button.disabled = false; }
});

initialize().catch((error) => { errorBox.textContent = error.message; });
