const form = document.querySelector("#auth-form");
const errorBox = document.querySelector("#error");
let setupRequired = false;
// Only the fixed, same-origin identity route is a permitted login return.
function afterLogin() {
  const next = new URLSearchParams(location.search).get('next');
  if (!next) return '/';
  try { const url=new URL(next,location.origin); return url.origin===location.origin && url.pathname==='/identity/authorize' ? url.pathname+url.search : '/'; } catch { return '/'; }
}

async function request(path, options) {
  const response = await fetch(path, { headers: { "Content-Type":"application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

async function initialize() {
  const status = await request("/api/auth/status");
  if (status.authenticated) return location.replace(afterLogin());
  setupRequired = status.setupRequired;
  const crm=await fetch('/identity/available',{cache:'no-store'}).catch(()=>null);
  if(crm?.ok){const link=document.createElement('a');link.href='/crm';link.textContent='Entrar no CRM / Representantes';link.style.display='block';link.style.marginTop='16px';form.after(link);}
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
  try { await request(setupRequired ? "/api/auth/setup" : "/api/auth/login", { method:"POST", body:JSON.stringify(body) }); location.replace(afterLogin()); }
  catch (error) { errorBox.textContent = error.message; button.disabled = false; }
});

initialize().catch((error) => { errorBox.textContent = error.message; });
