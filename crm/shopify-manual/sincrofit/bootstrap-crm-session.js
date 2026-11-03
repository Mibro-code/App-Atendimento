    // Cole este bloco dentro do IIFE da calculadora, imediatamente ANTES de:
    //   calculate();
    //   loadWholesaleMode();
    const loadCrmSession = async () => {
      const crmToken = new URLSearchParams(window.location.search).get('crm_session');
      if (!crmToken) return;

      root.querySelectorAll(
        '[data-start-simulation], [data-start-registration], [data-start-contact-only]'
      ).forEach((button) => { button.disabled = true; });

      try {
        const response = await fetch(
          `/apps/cnpj-validator/crm/session?token=${encodeURIComponent(crmToken)}`,
          { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin' }
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok !== true) {
          throw new Error(result.message || 'Link expirado ou já utilizado. Gere uma nova proposta no CRM.');
        }
        if (result.brand && result.brand !== 'SINCROFIT') {
          throw new Error('Este link pertence a outra empresa. Gere uma proposta Sincrofit no CRM.');
        }

        const customer = result.customer || {};
        const seller = result.seller || {};
        const setLockedField = (name, value) => {
          const field = form.elements[name];
          if (!field) return;
          field.value = value || '';
          field.readOnly = true;
          field.setAttribute('aria-readonly', 'true');
        };

        setLockedField('vendedor', seller.name);
        setLockedField('comprador', customer.contactName);
        setLockedField('telefone_contato', customer.phone);
        setLockedField('cnpj', formatCnpj(customer.cnpj));
        setLockedField('email', customer.email);
        setLockedField('razao_social', customer.legalName);
        setLockedField('nome_fantasia', customer.tradeName);
        if (form.elements.simulation_email) {
          form.elements.simulation_email.value = customer.email || '';
        }

        state.crmSession = result;
        state.crmMode = result.mode === 'simulation' ? 'simulation' : 'real';
        state.crmCustomerId = customer.id || '';
        state.crmSellerId = seller.id || '';
        state.flow = state.crmMode === 'simulation' ? 'simulation' : 'registration';
        state.resumeSummaryAfterRegistration = false;

        // Entrada pelo CRM nunca volta à tela que permite trocar manualmente
        // entre simulação/real. Esse modo foi decidido e assinado pelo CRM.
        root.querySelectorAll(
          '[data-back-choice], [data-back-contact-choice], [data-prev-step]'
        ).forEach((button) => { button.hidden = true; });

        if (state.crmMode === 'simulation') {
          state.pricingMode = 'mixed';
          state.pricingVerified = false;
          setStep(2);
          showMessage('success', 'Simulação Sincrofit iniciada pelo CRM.');
        } else {
          setStep(1);
          showMessage('success', 'Cotação real Sincrofit iniciada pelo CRM. Confira os dados e continue.');
          if (customer.cnpj) await consultCnpj();
        }
      } catch (error) {
        console.error('Falha ao carregar sessão do CRM.', error);
        setStep(0);
        root.querySelectorAll(
          '[data-start-simulation], [data-start-registration], [data-start-contact-only]'
        ).forEach((button) => { button.disabled = true; });
        showMessage('error', error?.message || 'Não foi possível validar o link do CRM.');
      }
    };

    // No fim do IIFE, mantenha estas três chamadas nesta ordem:
    calculate();
    loadWholesaleMode();
    loadCrmSession();
