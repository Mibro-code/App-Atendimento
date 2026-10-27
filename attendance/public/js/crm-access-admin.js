(() => {
  const status = document.querySelector('#team-crm-access-status');
  const refresh = document.querySelector('#team-crm-access-refresh');
  const toggle = document.querySelector('#team-crm-access-toggle');
  if (!status || !refresh || !toggle) return;
  let selected = null, revision = 0, enabled = false, busy = false;
  async function request(id, options = {}) {
    const response = await fetch(`/identity/admin-access/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.error || 'Não foi possível conferir o CRM.');
    return body;
  }
  function resetControls() { refresh.disabled = !selected || busy; toggle.disabled = true; }
  async function load(id) {
    selected = id;
    const version = ++revision;
    enabled = false; busy = Boolean(id); resetControls();
    toggle.textContent = 'Permitir acesso ao CRM';
    status.textContent = id ? 'Conferindo conta e vínculo no CRM…' : 'Salve a conta e selecione Editar para conferir o acesso.';
    if (!id) return;
    try {
      const data = await request(id);
      if (version !== revision) return;
      enabled = data.enabled;
      status.textContent = data.account ? `${data.account.name} · ${data.account.email} · ${data.account.role}. ${data.effective ? 'Acesso compartilhado ativo.' : enabled ? 'Permissão ativada, mas o vínculo precisa de revisão.' : 'Acesso compartilhado não ativado.'}${data.reason ? ` ${data.reason}` : ''}` : data.reason;
      toggle.textContent = enabled ? 'Desativar acesso ao CRM' : 'Permitir acesso ao CRM';
      toggle.disabled = !data.eligible && !enabled;
    } catch (error) {
      if (version === revision) status.textContent = error.message;
    } finally {
      if (version === revision) { busy = false; refresh.disabled = false; }
    }
  }
  refresh.addEventListener('click', () => { if (!busy) load(selected); });
  toggle.addEventListener('click', async () => {
    if (!selected || busy) return;
    const next = !enabled;
    if (!window.confirm(next ? 'Vincular estas contas? O e-mail e a senha do Atendimento serão usados nos dois sistemas. O cargo no CRM não muda.' : 'Desativar o acesso compartilhado? A conta e os dados serão preservados. O login do CRM desta identidade vinculada também será bloqueado.')) return;
    const id = selected, version = revision;
    busy = true; resetControls(); status.textContent = 'Salvando acesso ao CRM…';
    try {
      await request(id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      if (version === revision) await load(id);
    } catch (error) {
      if (version === revision) { status.textContent = `${error.message} Use Conferir vínculo antes de tentar novamente.`; toggle.disabled = true; }
    } finally {
      if (version === revision) { busy = false; refresh.disabled = false; }
    }
  });
  window.CrmAccessAdmin = { load };
})();
