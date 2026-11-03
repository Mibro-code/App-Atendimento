(() => {
  if (window.__cnpjValidatorLoaded) return;
  window.__cnpjValidatorLoaded = true;

  const DEFAULT_SELECTOR =
    "input[name*='cnpj' i], input[id*='cnpj' i], input[data-cnpj]";
  const OUTPUT_NAME_PATTERN =
    /(?:^|_)(?:razao_social|nome_fantasia|situacao_cadastral|inscricao_estadual|situacao_ie|contribuinte_icms|endereco|uf|cidade|cep|telefone|email)$/i;
  const VALID_DATA_LEVELS = ["verify", "essential", "complete"];
  const fieldStates = new WeakMap();
  let config;

  const digits = (value) => String(value || "").replace(/\D/g, "");

  function isValidCnpj(value) {
    const valueDigits = digits(value);
    if (valueDigits.length !== 14 || /^(\d)\1{13}$/.test(valueDigits)) {
      return false;
    }

    const calculateDigit = (length) => {
      let factor = length - 7;
      let sum = 0;
      for (let index = 0; index < length; index += 1) {
        sum += Number(valueDigits[index]) * factor;
        factor -= 1;
        if (factor === 1) factor = 9;
      }
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };

    return (
      calculateDigit(12) === Number(valueDigits[12]) &&
      calculateDigit(13) === Number(valueDigits[13])
    );
  }

  function formatCnpj(value) {
    return digits(value)
      .slice(0, 14)
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  function readConfig() {
    const element = document.querySelector("[data-cnpj-validator-config]");
    if (!element) return null;

    try {
      const parsed = JSON.parse(element.textContent);
      return {
        ...parsed,
        selector: parsed.selector || DEFAULT_SELECTOR,
        fieldPrefix: parsed.fieldPrefix || "cnpj_",
        configPath: parsed.configPath || "/apps/cnpj-validator/atacado/config",
        cnpjDataLevel: "complete",
      };
    } catch (error) {
      console.error("Configuração inválida do validador de CNPJ.", error);
      return null;
    }
  }

  function stateFor(field) {
    if (!fieldStates.has(field)) {
      fieldStates.set(field, {
        verifiedCnpj: "",
        pendingCnpj: "",
        pending: null,
        controller: null,
        filledElements: new Set(),
      });
    }
    return fieldStates.get(field);
  }

  function isCnpjField(field) {
    return (
      !field.hasAttribute("data-cnpj-output") &&
      !field.hasAttribute("data-cnpj-validator-ignore") &&
      !OUTPUT_NAME_PATTERN.test(field.name || "")
    );
  }

  function setStatus(field, message, tone) {
    const state = stateFor(field);
    if (!state.statusElement) {
      const status = document.createElement("span");
      status.className = "cnpj-validator-status";
      status.setAttribute("aria-live", "polite");
      status.setAttribute("data-cnpj-output", "");
      field.insertAdjacentElement("afterend", status);
      state.statusElement = status;
    }
    state.statusElement.textContent = message;
    state.statusElement.dataset.tone = tone;
  }

  function setValidity(field, message) {
    if (typeof field.setCustomValidity === "function") {
      field.setCustomValidity(message);
    }
  }

  function emitValueChange(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function clearCompany(field) {
    const state = stateFor(field);
    state.verifiedCnpj = "";
    for (const element of state.filledElements) {
      element.value = "";
      emitValueChange(element);
    }
    state.filledElements.clear();
  }

  function dataLevelFor(field) {
    const localLevel =
      field.dataset.cnpjLevel ||
      field.closest("[data-cnpj-level]")?.dataset.cnpjLevel;
    return VALID_DATA_LEVELS.includes(localLevel)
      ? localLevel
      : config.cnpjDataLevel;
  }

  function outputDefinitions(company, dataLevel) {
    const stateRegistration = company.stateRegistration || {};
    const unavailable = "Não foi possível verificar";
    const stateRegistrationNumber =
      stateRegistration.number ||
      (stateRegistration.available ? "Não encontrada" : unavailable);
    const stateRegistrationStatus =
      stateRegistration.status ||
      (stateRegistration.available
        ? "Sem inscrição estadual ativa"
        : unavailable);
    const icmsTaxpayer =
      stateRegistration.icmsTaxpayer === true
        ? "Sim"
        : stateRegistration.icmsTaxpayer === false
          ? "Não"
          : unavailable;

    return [
      {
        key: "razao_social",
        label: config.labels.legalName,
        value: company.legalName,
        enabled: true,
        wide: true,
      },
      {
        key: "nome_fantasia",
        label: config.labels.tradeName,
        value: company.tradeName,
        enabled: config.showTradeName,
        wide: true,
      },
      {
        key: "situacao_cadastral",
        label: config.labels.status,
        value: company.registrationStatus,
        enabled: config.showStatus,
      },
      {
        key: "inscricao_estadual",
        label: config.labels.stateRegistration,
        value: stateRegistrationNumber,
        enabled: config.showStateRegistration,
      },
      {
        key: "situacao_ie",
        label: config.labels.stateRegistrationStatus,
        value: stateRegistrationStatus,
        enabled: config.showStateRegistration,
      },
      {
        key: "contribuinte_icms",
        label: config.labels.icmsTaxpayer,
        value: icmsTaxpayer,
        enabled: config.showStateRegistration,
      },
      {
        key: "endereco",
        label: config.labels.address,
        value: company.address?.formatted || "",
        enabled: config.showAddress,
        wide: true,
      },
      {
        key: "uf",
        label: config.labels.state,
        value: company.address?.state || "",
        enabled: config.showLocationDetails,
      },
      {
        key: "cidade",
        label: config.labels.city,
        value: company.address?.city || "",
        enabled: config.showLocationDetails,
      },
      {
        key: "cep",
        label: config.labels.postalCode,
        value: company.address?.postalCode || "",
        enabled: config.showLocationDetails,
      },
      {
        key: "telefone",
        label: config.labels.phone,
        value: company.phone,
        enabled: config.showPhone,
      },
      {
        key: "email",
        label: config.labels.email,
        value: company.email,
        enabled: config.showEmail,
      },
    ].filter((definition) => {
      if (!definition.enabled || dataLevel === "verify") {
        return false;
      }
      if (dataLevel === "essential") {
        return ["razao_social", "endereco", "telefone", "email"].includes(
          definition.key,
        );
      }
      return true;
    });
  }

  function findOutput(form, name) {
    return Array.from(form.elements).find(
      (element) =>
        element.name === name &&
        !element.hasAttribute("data-cnpj-validator-attached"),
    );
  }

  function createOutput(field, definition) {
    const state = stateFor(field);
    if (!state.fieldsElement) {
      const fields = document.createElement("div");
      fields.className = "cnpj-validator-fields";
      fields.setAttribute("data-cnpj-output", "");
      const anchor =
        field.closest(
          "[data-cnpj-field-container], .form-field, .form__field, .field",
        ) || field.parentElement;
      anchor.insertAdjacentElement("afterend", fields);
      state.fieldsElement = fields;
    }

    const name = `${config.fieldPrefix}${definition.key}`;
    const existing = findOutput(field.form, name);
    if (existing) return existing;

    const wrapper = document.createElement("div");
    wrapper.className = `cnpj-validator-field${
      definition.wide ? " cnpj-validator-field--wide" : ""
    }`;
    wrapper.setAttribute("data-cnpj-output", "");

    const label = document.createElement("label");
    const input = document.createElement("input");
    const id = `cnpj-validator-${definition.key}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    label.htmlFor = id;
    label.textContent = definition.label;
    input.id = id;
    input.name = name;
    input.type = definition.key === "email" ? "email" : "text";
    input.readOnly = false;
    input.setAttribute("data-cnpj-output", "");
    input.autocomplete = "off";

    wrapper.append(label, input);
    state.fieldsElement.append(wrapper);
    return input;
  }

  function fillCompany(field, company) {
    const state = stateFor(field);
    for (const definition of outputDefinitions(company, dataLevelFor(field))) {
      const output = createOutput(field, definition);
      output.value = definition.value || "";
      state.filledElements.add(output);
      emitValueChange(output);
    }
  }

  async function verifyField(field, { report = false } = {}) {
    const state = stateFor(field);
    const cnpj = digits(field.value);

    if (!isValidCnpj(cnpj)) {
      clearCompany(field);
      const message = "Informe um CNPJ válido com 14 dígitos.";
      setValidity(field, message);
      setStatus(field, message, "error");
      if (report && typeof field.reportValidity === "function") {
        field.reportValidity();
      }
      return false;
    }

    if (state.verifiedCnpj === cnpj) return true;
    if (state.pending && state.pendingCnpj === cnpj) {
      return state.pending;
    }

    state.controller?.abort();
    state.controller = new AbortController();
    state.pendingCnpj = cnpj;
    setValidity(field, "Aguarde a verificação do CNPJ.");
    setStatus(field, "Consultando dados da empresa…", "loading");

    state.pending = (async () => {
      try {
        const url = new URL(config.proxyPath, window.location.origin);
        url.searchParams.set("cnpj", cnpj);
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: state.controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) {
          throw new Error(
            result?.message || "Não foi possível verificar o CNPJ agora.",
          );
        }

        const status = String(
          result.company.registrationStatus || "",
        ).toUpperCase();
        if (config.requireActive && status !== "ATIVA") {
          throw new Error(
            `A situação cadastral desta empresa é ${
              result.company.registrationStatus || "desconhecida"
            }.`,
          );
        }

        clearCompany(field);
        fillCompany(field, result.company);
        state.verifiedCnpj = cnpj;
        setValidity(field, "");
        setStatus(
          field,
          `CNPJ verificado: ${result.company.legalName}.`,
          "success",
        );
        return true;
      } catch (error) {
        if (error.name === "AbortError") return false;
        clearCompany(field);
        const message =
          error.message || "Não foi possível verificar o CNPJ agora.";
        setValidity(field, message);
        setStatus(field, message, "error");
        if (report && typeof field.reportValidity === "function") {
          field.reportValidity();
        }
        return false;
      } finally {
        if (state.pendingCnpj === cnpj) {
          state.pending = null;
          state.pendingCnpj = "";
        }
      }
    })();

    return state.pending;
  }

  function attach(field) {
    if (field.dataset.cnpjValidatorAttached === "true" || !isCnpjField(field)) {
      return;
    }

    field.dataset.cnpjValidatorAttached = "true";
    field.inputMode = "numeric";
    field.maxLength = 18;
    field.addEventListener("input", () => {
      const state = stateFor(field);
      state.controller?.abort();
      clearCompany(field);
      setValidity(field, "");
      field.value = formatCnpj(field.value);
    });
    field.addEventListener("blur", () => {
      if (digits(field.value).length > 0) void verifyField(field);
    });
    field.addEventListener("change", () => {
      if (digits(field.value).length > 0) void verifyField(field);
    });
  }

  function scan(root = document) {
    let fields = [];
    try {
      fields = Array.from(root.querySelectorAll(config.selector));
    } catch (error) {
      console.error(
        "Seletor de CNPJ inválido; usando o seletor padrão.",
        error,
      );
      config.selector = DEFAULT_SELECTOR;
      fields = Array.from(root.querySelectorAll(config.selector));
    }
    fields.filter(isCnpjField).forEach(attach);
  }

  function onSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    let fields;
    try {
      fields = Array.from(form.querySelectorAll(config.selector)).filter(
        (field) =>
          isCnpjField(field) &&
          (field.required || digits(field.value).length > 0),
      );
    } catch {
      return;
    }

    if (fields.length === 0 || form.dataset.cnpjValidatorSubmitting) {
      delete form.dataset.cnpjValidatorSubmitting;
      return;
    }

    const allVerified = fields.every((field) => {
      const state = stateFor(field);
      return state.verifiedCnpj && state.verifiedCnpj === digits(field.value);
    });
    if (allVerified) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const submitter = event.submitter;
    void Promise.all(
      fields.map((field) => verifyField(field, { report: true })),
    ).then((results) => {
      if (results.every(Boolean)) {
        form.dataset.cnpjValidatorSubmitting = "true";
        form.requestSubmit(submitter);
      }
    });
  }

  async function loadGlobalConfig() {
    if (!config.configPath) return;

    try {
      const response = await fetch(config.configPath, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      const result = await response.json();
      if (response.ok && VALID_DATA_LEVELS.includes(result.cnpjDataLevel)) {
        config.cnpjDataLevel = result.cnpjDataLevel;
      }
    } catch (error) {
      console.warn(
        "Não foi possível carregar a configuração global do CNPJ; usando consulta completa.",
        error,
      );
    }
  }

  async function initialize() {
    config = readConfig();
    if (!config) return;

    await loadGlobalConfig();
    scan();
    document.addEventListener("submit", onSubmit, true);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (isCnpjField(node) && node.matches(config.selector)) {
            attach(node);
          }
          scan(node);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, {
      once: true,
    });
  } else {
    initialize();
  }
})();
