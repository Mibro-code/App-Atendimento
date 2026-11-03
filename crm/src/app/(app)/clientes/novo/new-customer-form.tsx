"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { requestLocationAttempt, type LocationAttempt } from "@/lib/geolocation-client";
import { BRAZIL_STATES } from "@/lib/brazil-states";
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPE_VALUES, CUSTOMER_INTEREST_LABELS, CUSTOMER_INTEREST_VALUES, INTERESTED_BRAND_LABELS, INTERESTED_BRAND_VALUES } from "@/lib/customer-fields";
import { SP_REGION_SUGGESTIONS } from "@/lib/sp-regions";

interface DuplicateCandidate {
  id: string;
  contactName: string;
  tradeName?: string | null;
  legalName?: string | null;
  seller: { name: string };
}

// Mesma ordem visual do formulário abaixo — usada só para decidir em qual
// campo focar primeiro quando o backend devolve mais de um erro de uma vez.
const FIELD_ORDER = [
  "contactName", "tradeName", "legalName", "cnpjDigits", "cpfDigits", "email", "phoneDigits",
  "phone2Digits", "phone3Digits", "leadOrigin", "businessType", "industrySegment", "interestedBrand",
  "addressStreet", "addressNumber", "addressComplement", "addressDistrict", "city", "state", "spRegion", "zipDigits", "notes",
] as const;

export function NewCustomerForm({conversationId}:{conversationId?:string}={}) {
  const router = useRouter();
  const [form, setForm] = useState({
    contactName: "",
    tradeName: "",
    legalName: "",
    cnpjDigits: "",
    cpfDigits: "",
    email: "",
    phoneDigits: "",
    phone2Digits: "", phone3Digits: "",
    addressStreet: "",
    addressNumber: "",
    addressDistrict: "",
    addressComplement: "",
    city: "",
    state: "",
    spRegion: "",
    zipDigits: "",
    leadOrigin: "",
    businessType: "",
    industrySegment: "",
    worksWithSmartwatch: "",
    interestedBrand: "",
    notes: "",
  });
  const [interests, setInterests] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [locationAttempt, setLocationAttempt] = useState<LocationAttempt | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const [sourceLoading,setSourceLoading]=useState(Boolean(conversationId));
  const [sourceError,setSourceError]=useState('');
  useEffect(()=>{
    if(!conversationId)return;
    const abort=new AbortController();setSourceLoading(true);
    fetch('/api/attendance-context?'+new URLSearchParams({conversationId}),{cache:'no-store',signal:abort.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw Error(body.error||'Origem indisponível.');
      if(body.customers?.length)throw Error('Já há cadastro com este telefone na sua carteira. Abra o cadastro existente pelo painel da conversa.');
      setForm(previous=>({...previous,contactName:previous.contactName||body.lead.name,phoneDigits:previous.phoneDigits||body.lead.phone,leadOrigin:previous.leadOrigin||body.lead.origin}));
    }).catch(e=>{if(!abort.signal.aborted)setSourceError(e.message);}).finally(()=>{if(!abort.signal.aborted)setSourceLoading(false);});
    return()=>abort.abort();
  },[conversationId]);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    // Erro some assim que o vendedor começa a corrigir o campo — evita
    // deixar uma borda vermelha "presa" num valor que já foi editado.
    if (fieldErrors[key]) setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  }

  function focusFirstError(errors: Record<string, string>) {
    const firstKey = FIELD_ORDER.find((key) => errors[key]);
    if (!firstKey) return;
    const node = fieldRefs.current[firstKey];
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    node?.focus();
  }

  function inputClass(key: string) {
    return fieldErrors[key] ? "input-field input-field-error" : "input-field";
  }

  async function submit(confirmDuplicate: boolean) {
    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      let currentLocation = locationAttempt;
      if (!currentLocation) {
        setLocationMessage("Solicitando localização ao navegador...");
        currentLocation = await requestLocationAttempt();
        setLocationAttempt(currentLocation);
        setLocationMessage(
          currentLocation.status === "GRANTED"
            ? "Localização registrada neste cadastro."
            : currentLocation.status === "DENIED"
              ? "Localização recusada. O cadastro continuará; para permitir depois, reative a permissão do site no navegador."
              : "Não foi possível obter a localização. O cadastro continuará normalmente."
        );
      }
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          worksWithSmartwatch: form.worksWithSmartwatch === "" ? null : form.worksWithSmartwatch === "SIM",
          interests,
          confirmDuplicate,
          locationAttempt: currentLocation,
        }),
      });

      if (res.status === 409) {
        const data = await res.json();
        setDuplicates(data.possibleDuplicates);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errors: Record<string, string> = data.fieldErrors || {};
        setFieldErrors(errors);
        setError(Object.keys(errors).length > 0 ? "Revise os campos destacados." : (data.error || "Não foi possível cadastrar o cliente. Tente novamente."));
        focusFirstError(errors);
        setLoading(false);
        return;
      }

      const data = await res.json();
      router.push(`/clientes/${data.customer.id}`);
      router.refresh();
    } catch {
      setError("Erro de rede ao cadastrar cliente.");
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setDuplicates(null);
    await submit(false);
  }

  if (duplicates && duplicates.length > 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-medium text-amber-800 mb-2">
            Encontramos possíveis clientes duplicados:
          </p>
          <ul className="text-sm text-amber-700 space-y-1">
            {duplicates.map((d) => (
              <li key={d.id}>
                {d.tradeName || d.contactName} — vendedor: {d.seller.name}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-3">
          <button className="btn-secondary" onClick={() => setDuplicates(null)} disabled={loading}>
            Voltar e revisar
          </button>
          <button className="btn-primary" onClick={() => submit(true)} disabled={loading}>
            {loading ? "Cadastrando..." : "Cadastrar mesmo assim"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label-field">Nome do contato *</label>
          <input
            ref={(node) => { fieldRefs.current.contactName = node; }}
            className={inputClass("contactName")}
            value={form.contactName}
            onChange={(e) => update("contactName", e.target.value)}
            aria-invalid={Boolean(fieldErrors.contactName)}
          />
          {fieldErrors.contactName && <p className="mt-1 text-xs text-red-600">{fieldErrors.contactName}</p>}
        </div>
        <div>
          <label className="label-field">Nome fantasia</label>
          <input
            ref={(node) => { fieldRefs.current.tradeName = node; }}
            className={inputClass("tradeName")}
            value={form.tradeName}
            onChange={(e) => update("tradeName", e.target.value)}
          />
          {fieldErrors.tradeName && <p className="mt-1 text-xs text-red-600">{fieldErrors.tradeName}</p>}
        </div>
        <div>
          <label className="label-field">Razão social</label>
          <input
            ref={(node) => { fieldRefs.current.legalName = node; }}
            className={inputClass("legalName")}
            value={form.legalName}
            onChange={(e) => update("legalName", e.target.value)}
          />
          {fieldErrors.legalName && <p className="mt-1 text-xs text-red-600">{fieldErrors.legalName}</p>}
        </div>
        <div>
          <label className="label-field">CNPJ</label>
          <input
            ref={(node) => { fieldRefs.current.cnpjDigits = node; }}
            className={inputClass("cnpjDigits")}
            value={form.cnpjDigits}
            onChange={(e) => update("cnpjDigits", e.target.value)}
            placeholder="Somente números"
            aria-invalid={Boolean(fieldErrors.cnpjDigits)}
          />
          {fieldErrors.cnpjDigits && <p className="mt-1 text-xs text-red-600">{fieldErrors.cnpjDigits}</p>}
        </div>
        <div>
          <label className="label-field">CPF</label>
          <input
            ref={(node) => { fieldRefs.current.cpfDigits = node; }}
            className={inputClass("cpfDigits")}
            value={form.cpfDigits}
            onChange={(e) => update("cpfDigits", e.target.value)}
            placeholder="Somente números"
            aria-invalid={Boolean(fieldErrors.cpfDigits)}
          />
          {fieldErrors.cpfDigits && <p className="mt-1 text-xs text-red-600">{fieldErrors.cpfDigits}</p>}
        </div>
        <div>
          <label className="label-field">E-mail</label>
          <input
            ref={(node) => { fieldRefs.current.email = node; }}
            type="email"
            className={inputClass("email")}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email && <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
        </div>
        {([["phoneDigits", "Telefone principal"], ["phone2Digits", "Telefone 2"], ["phone3Digits", "Telefone 3"]] as const).map(([key, label]) => <CustomerPhoneField key={key} label={label} value={form[key]} onValue={(value) => update(key, value)} error={fieldErrors[key]} inputRef={(node) => { fieldRefs.current[key] = node; }} />)}
        <div>
          <label className="label-field">Origem do lead</label>
          <input
            ref={(node) => { fieldRefs.current.leadOrigin = node; }}
            className={inputClass("leadOrigin")}
            value={form.leadOrigin}
            onChange={(e) => update("leadOrigin", e.target.value)}
            placeholder="Indicação, feira, site..."
          />
          {fieldErrors.leadOrigin && <p className="mt-1 text-xs text-red-600">{fieldErrors.leadOrigin}</p>}
        </div>
        <div>
          <label className="label-field">Tipo de negócio</label>
          <select
            ref={(node) => { fieldRefs.current.businessType = node; }}
            className={inputClass("businessType")}
            value={form.businessType}
            onChange={(e) => update("businessType", e.target.value)}
          >
            <option value="">Selecione</option>
            {BUSINESS_TYPE_VALUES.filter((value) => value !== "OUTRO").map((value) => <option key={value} value={value}>{BUSINESS_TYPE_LABELS[value]}</option>)}
          </select>
          {fieldErrors.businessType && <p className="mt-1 text-xs text-red-600">{fieldErrors.businessType}</p>}
        </div>
        <div>
          <label className="label-field">Segmento de atuação da empresa</label>
          <input
            ref={(node) => { fieldRefs.current.industrySegment = node; }}
            className={inputClass("industrySegment")}
            value={form.industrySegment}
            onChange={(e) => update("industrySegment", e.target.value)}
            placeholder="Eletrônicos, informática, utilidades..."
          />
          {fieldErrors.industrySegment && <p className="mt-1 text-xs text-red-600">{fieldErrors.industrySegment}</p>}
        </div>
        <div>
          <label className="label-field">Já trabalha com Smartwatch?</label>
          <select className="input-field" value={form.worksWithSmartwatch} onChange={(e) => update("worksWithSmartwatch", e.target.value)}>
            <option value="">Não informado</option><option value="SIM">Sim</option><option value="NAO">Não</option>
          </select>
        </div>
        <div>
          <label className="label-field">Empresa de interesse</label>
          <select
            ref={(node) => { fieldRefs.current.interestedBrand = node; }}
            className={inputClass("interestedBrand")}
            value={form.interestedBrand}
            onChange={(e) => update("interestedBrand", e.target.value)}
          >
            <option value="">Não informado</option>
            {INTERESTED_BRAND_VALUES.map((value) => <option key={value} value={value}>{INTERESTED_BRAND_LABELS[value]}</option>)}
          </select>
          {fieldErrors.interestedBrand && <p className="mt-1 text-xs text-red-600">{fieldErrors.interestedBrand}</p>}
        </div>
        <div>
          <label className="label-field">Endereço</label>
          <input
            ref={(node) => { fieldRefs.current.addressStreet = node; }}
            className={inputClass("addressStreet")}
            value={form.addressStreet}
            onChange={(e) => update("addressStreet", e.target.value)}
            placeholder="Rua, avenida..."
          />
          {fieldErrors.addressStreet && <p className="mt-1 text-xs text-red-600">{fieldErrors.addressStreet}</p>}
        </div>
        <div>
          <label className="label-field">Número</label>
          <input
            ref={(node) => { fieldRefs.current.addressNumber = node; }}
            className={inputClass("addressNumber")}
            value={form.addressNumber}
            onChange={(e) => update("addressNumber", e.target.value)}
          />
          {fieldErrors.addressNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.addressNumber}</p>}
        </div>
        <div>
          <label className="label-field">Complemento</label>
          <input
            ref={(node) => { fieldRefs.current.addressComplement = node; }}
            className={inputClass("addressComplement")}
            value={form.addressComplement}
            onChange={(e) => update("addressComplement", e.target.value)}
            placeholder="Sala, bloco, loja..."
          />
          {fieldErrors.addressComplement && <p className="mt-1 text-xs text-red-600">{fieldErrors.addressComplement}</p>}
        </div>
        <div>
          <label className="label-field">Bairro</label>
          <input
            ref={(node) => { fieldRefs.current.addressDistrict = node; }}
            className={inputClass("addressDistrict")}
            value={form.addressDistrict}
            onChange={(e) => update("addressDistrict", e.target.value)}
          />
          {fieldErrors.addressDistrict && <p className="mt-1 text-xs text-red-600">{fieldErrors.addressDistrict}</p>}
        </div>
        <div>
          <label className="label-field">Cidade</label>
          <input
            ref={(node) => { fieldRefs.current.city = node; }}
            className={inputClass("city")}
            value={form.city}
            onChange={(e) => update("city", e.target.value)}
          />
          {fieldErrors.city && <p className="mt-1 text-xs text-red-600">{fieldErrors.city}</p>}
        </div>
        <div>
          <label className="label-field">Estado (UF)</label>
          <select
            ref={(node) => { fieldRefs.current.state = node; }}
            className={inputClass("state")}
            value={form.state}
            onChange={(e) => setForm((current) => ({ ...current, state: e.target.value, spRegion: e.target.value === "SP" ? current.spRegion : "" }))}
          >
            <option value="">Selecione o estado</option>
            {BRAZIL_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
          {fieldErrors.state && <p className="mt-1 text-xs text-red-600">{fieldErrors.state}</p>}
        </div>
        <div>
          <label className="label-field">Região de São Paulo</label>
          <input
            ref={(node) => { fieldRefs.current.spRegion = node; }}
            className={inputClass("spRegion")}
            list="sp-region-suggestions-new"
            disabled={form.state !== "SP"}
            value={form.spRegion}
            onChange={(e) => update("spRegion", e.target.value)}
            placeholder={form.state === "SP" ? "Selecione ou informe a região" : "Disponível para o estado SP"}
          />
          <datalist id="sp-region-suggestions-new">
            {SP_REGION_SUGGESTIONS.map((region) => <option key={region} value={region} />)}
          </datalist>
          {fieldErrors.spRegion && <p className="mt-1 text-xs text-red-600">{fieldErrors.spRegion}</p>}
        </div>
        <div>
          <label className="label-field">CEP</label>
          <input
            ref={(node) => { fieldRefs.current.zipDigits = node; }}
            className={inputClass("zipDigits")}
            value={form.zipDigits}
            onChange={(e) => update("zipDigits", e.target.value)}
            placeholder="Somente números"
          />
          {fieldErrors.zipDigits && <p className="mt-1 text-xs text-red-600">{fieldErrors.zipDigits}</p>}
        </div>
      </div>
      <fieldset>
        <legend className="label-field">Produtos de interesse</legend>
        <div className="flex flex-wrap gap-3 rounded-md border border-gray-200 p-3">
          {CUSTOMER_INTEREST_VALUES.map((value) => <label key={value} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={interests.includes(value)} onChange={(event) => setInterests((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} />
            {CUSTOMER_INTEREST_LABELS[value]}
          </label>)}
        </div>
      </fieldset>
      <div>
        <label className="label-field">Observações</label>
        <textarea
          ref={(node) => { fieldRefs.current.notes = node; }}
          className={inputClass("notes")}
          rows={3}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
        />
        {fieldErrors.notes && <p className="mt-1 text-xs text-red-600">{fieldErrors.notes}</p>}
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        <p>Ao cadastrar, o navegador solicitará sua localização para registrar onde o cliente foi incluído. Não há rastreamento contínuo.</p>
        {locationMessage && <p className="mt-1 font-medium">{locationMessage}</p>}
      </div>
      <div className="flex gap-3">
        {conversationId?<p role="status" className="text-sm text-gray-500">{sourceLoading?'Consultando origem no Atendimento…':sourceError||'Dados do Atendimento preenchidos. Revise antes de cadastrar; o responsável será definido pelas regras do CRM.'}</p>:null}
        <button type="submit" className="btn-primary" disabled={loading||sourceLoading||Boolean(sourceError)}>
          {loading ? "Verificando..." : "Cadastrar cliente"}
        </button>
      </div>
    </form>
  );
}
