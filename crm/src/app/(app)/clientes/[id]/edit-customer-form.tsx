"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { BRAZIL_STATES } from "@/lib/brazil-states";
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPE_VALUES, CUSTOMER_INTEREST_LABELS, CUSTOMER_INTEREST_VALUES, INTERESTED_BRAND_LABELS, INTERESTED_BRAND_VALUES } from "@/lib/customer-fields";
import { SP_REGION_SUGGESTIONS } from "@/lib/sp-regions";

type EditableCustomer = {
  phone2Digits: string | null; phone3Digits: string | null; phoneChannel: string | null; phone2Channel: string | null; phone3Channel: string | null;
  id: string; contactName: string; legalName: string | null; tradeName: string | null;
  cnpjDigits: string | null; cpfDigits: string | null; email: string | null; phoneDigits: string | null;
  addressStreet: string | null; addressNumber: string | null; addressDistrict: string | null; addressComplement: string | null;
  city: string | null; state: string | null; spRegion: string | null; zipDigits: string | null; leadOrigin: string | null;
  businessType: string | null; industrySegment: string | null; worksWithSmartwatch: boolean | null;
  interests: string[]; interestedBrand: string | null; leadCapturedAt: string | null; notes: string | null;
};

export function EditCustomerForm({ customer }: { customer: EditableCustomer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    phone2Digits: customer.phone2Digits ?? "", phone3Digits: customer.phone3Digits ?? "",
    contactName: customer.contactName, legalName: customer.legalName ?? "", tradeName: customer.tradeName ?? "",
    cnpjDigits: customer.cnpjDigits ?? "", cpfDigits: customer.cpfDigits ?? "", email: customer.email ?? "",
    phoneDigits: customer.phoneDigits ?? "", addressStreet: customer.addressStreet ?? "", addressNumber: customer.addressNumber ?? "",
    addressDistrict: customer.addressDistrict ?? "", addressComplement: customer.addressComplement ?? "", city: customer.city ?? "", state: customer.state ?? "", spRegion: customer.spRegion ?? "",
    zipDigits: customer.zipDigits ?? "", leadOrigin: customer.leadOrigin ?? "", businessType: customer.businessType ?? "",
    industrySegment: customer.industrySegment ?? "", worksWithSmartwatch: customer.worksWithSmartwatch == null ? "" : customer.worksWithSmartwatch ? "true" : "false",
    interestedBrand: customer.interestedBrand ?? "", leadCapturedAt: customer.leadCapturedAt ? customer.leadCapturedAt.slice(0, 16) : "",
    notes: customer.notes ?? "",
  });
  const [interests, setInterests] = useState(customer.interests);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fieldRefs = useRef<Partial<Record<string, HTMLElement | null>>>({});
  const update = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next; });
  };
  const inputClass = (key: string) => fieldErrors[key] ? "input-field input-field-error" : "input-field";
  const setFieldRef = (key: string) => (node: HTMLElement | null) => { fieldRefs.current[key] = node; };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setMessage(""); setFieldErrors({});
    const response = await fetch(`/api/customers/${customer.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        worksWithSmartwatch: form.worksWithSmartwatch === "" ? null : form.worksWithSmartwatch === "true",
        interests,
        leadCapturedAt: form.leadCapturedAt ? new Date(form.leadCapturedAt).toISOString() : null,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      const errors: Record<string, string> = data.fieldErrors || {};
      setFieldErrors(errors);
      setMessage(Object.keys(errors).length > 0 ? "Revise os campos destacados." : (data.error ?? "Não foi possível salvar. Tente novamente."));
      const firstKey = Object.keys(fieldRefs.current).find((key) => errors[key]);
      if (firstKey) { fieldRefs.current[firstKey]?.scrollIntoView({ behavior: "smooth", block: "center" }); fieldRefs.current[firstKey]?.focus(); }
      return;
    }
    setMessage("Cliente atualizado."); setOpen(false); router.refresh();
  }

  if (!open) return <button className="btn-secondary" type="button" onClick={() => setOpen(true)}>Editar cliente</button>;
  return (
    <form onSubmit={save} className="card p-5 space-y-4" noValidate>
      <div className="flex items-center justify-between"><h2 className="font-semibold text-gray-800">Editar cliente</h2><button type="button" className="text-sm underline" onClick={() => setOpen(false)}>Cancelar</button></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {([["phoneDigits", "Telefone principal"], ["phone2Digits", "Telefone 2"], ["phone3Digits", "Telefone 3"]] as const).map(([key, label]) => <CustomerPhoneField key={key} label={label} value={form[key]} onValue={(value) => update(key, value)} error={fieldErrors[key]} inputRef={setFieldRef(key)} />)}
        {([["contactName","Nome do contato *"],["tradeName","Nome fantasia"],["legalName","Razão social"],["cnpjDigits","CNPJ"],["cpfDigits","CPF"],["email","E-mail"],["addressStreet","Endereço"],["addressNumber","Número"],["addressComplement","Complemento"],["addressDistrict","Bairro"],["city","Cidade"],["zipDigits","CEP"],["industrySegment","Segmento de atuação"],["leadOrigin","Origem do lead"]] as const).map(([key,label]) => <div key={key}><label className="label-field">{label}</label><input ref={setFieldRef(key)} required={key === "contactName"} type={key === "email" ? "email" : "text"} className={inputClass(key)} value={form[key]} onChange={(event) => update(key,event.target.value)} />{fieldErrors[key] && <p className="mt-1 text-xs text-red-600">{fieldErrors[key]}</p>}</div>)}
        <div><label className="label-field">Estado</label><select ref={setFieldRef("state")} className={inputClass("state")} value={form.state} onChange={(event) => setForm((current) => ({...current,state:event.target.value,spRegion:event.target.value === "SP" ? current.spRegion : ""}))}><option value="">Não informado</option>{BRAZIL_STATES.map((state) => <option key={state}>{state}</option>)}</select>{fieldErrors.state && <p className="mt-1 text-xs text-red-600">{fieldErrors.state}</p>}</div>
        <div><label className="label-field">Região de São Paulo</label><input ref={setFieldRef("spRegion")} className={inputClass("spRegion")} list="sp-region-suggestions-edit" disabled={form.state !== "SP"} value={form.spRegion} onChange={(event) => update("spRegion",event.target.value)} placeholder={form.state === "SP" ? "Selecione ou informe a região" : "Disponível para o estado SP"} /><datalist id="sp-region-suggestions-edit">{SP_REGION_SUGGESTIONS.map((region) => <option key={region} value={region} />)}</datalist>{fieldErrors.spRegion && <p className="mt-1 text-xs text-red-600">{fieldErrors.spRegion}</p>}</div>
        <div><label className="label-field">Tipo de negócio</label><select ref={setFieldRef("businessType")} className={inputClass("businessType")} value={form.businessType} onChange={(event) => update("businessType",event.target.value)}><option value="">Não informado</option>{BUSINESS_TYPE_VALUES.map((value) => <option key={value} value={value}>{BUSINESS_TYPE_LABELS[value]}</option>)}</select>{fieldErrors.businessType && <p className="mt-1 text-xs text-red-600">{fieldErrors.businessType}</p>}</div>
        <div><label className="label-field">Já trabalha com Smartwatch?</label><select className="input-field" value={form.worksWithSmartwatch} onChange={(event) => update("worksWithSmartwatch",event.target.value)}><option value="">Não informado</option><option value="true">Sim</option><option value="false">Não</option></select></div>
        <div><label className="label-field">Empresa de interesse</label><select ref={setFieldRef("interestedBrand")} className={inputClass("interestedBrand")} value={form.interestedBrand} onChange={(event) => update("interestedBrand",event.target.value)}><option value="">Não informado</option>{INTERESTED_BRAND_VALUES.map((value) => <option key={value} value={value}>{INTERESTED_BRAND_LABELS[value]}</option>)}</select>{fieldErrors.interestedBrand && <p className="mt-1 text-xs text-red-600">{fieldErrors.interestedBrand}</p>}</div>
        <div><label className="label-field">Carimbo original/importação</label><input type="datetime-local" className="input-field" value={form.leadCapturedAt} onChange={(event) => update("leadCapturedAt",event.target.value)} /></div>
      </div>
      <fieldset><legend className="label-field">Produtos de interesse</legend><div className="flex flex-wrap gap-3 rounded-md border p-3">{CUSTOMER_INTEREST_VALUES.map((value) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={interests.includes(value)} onChange={(event) => setInterests((current) => event.target.checked ? [...new Set([...current,value])] : current.filter((item) => item !== value))} />{CUSTOMER_INTEREST_LABELS[value]}</label>)}</div></fieldset>
      <div><label className="label-field">Observações</label><textarea ref={setFieldRef("notes")} className={inputClass("notes")} rows={3} value={form.notes} onChange={(event) => update("notes",event.target.value)} />{fieldErrors.notes && <p className="mt-1 text-xs text-red-600">{fieldErrors.notes}</p>}</div>
      {message && <p className="text-sm text-red-600" role="alert">{message}</p>}
      <button className="btn-primary" disabled={loading}>{loading ? "Salvando..." : "Salvar alterações"}</button>
    </form>
  );
}
