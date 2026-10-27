"use client";

import { useState } from "react";
import type { CustomerOption } from "@/components/agenda/customer-autocomplete";

interface Duplicate {
  id: string;
  contactName: string;
  tradeName: string | null;
  seller?: { name: string } | null;
}

/**
 * Cadastro rápido dentro da calculadora: só os dados mínimos, usando a mesma
 * API (validação, duplicidade e escopo) do cadastro completo. Cria apenas o
 * cliente — nenhuma cotação ou pedido é criado aqui.
 */
export function QuickCustomerForm({ onCreated, onCancel }: { onCreated: (c: CustomerOption) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ contactName: "", tradeName: "", document: "", phone: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(confirmDuplicate: boolean) {
    setBusy(true);
    setMessage(null);
    const digits = form.document.replace(/\D/g, "");
    const response = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactName: form.contactName,
        tradeName: form.tradeName || undefined,
        cnpjDigits: digits.length > 11 ? digits : undefined,
        cpfDigits: digits.length > 0 && digits.length <= 11 ? digits : undefined,
        phoneDigits: form.phone || undefined,
        email: form.email || undefined,
        confirmDuplicate,
      }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => ({})) : {};
    setBusy(false);

    if (response?.status === 409 && body.possibleDuplicates) {
      setDuplicates(body.possibleDuplicates);
      return;
    }
    if (!response || !response.ok) {
      const fe: Record<string, string> = body.fieldErrors || {};
      setErrors({ ...fe, document: fe.cnpjDigits || fe.cpfDigits || "", phone: fe.phoneDigits || "" });
      setMessage(response ? body.error || "Não foi possível cadastrar." : "Erro de conexão.");
      return;
    }
    onCreated({ id: body.customer.id, name: body.customer.tradeName || body.customer.contactName });
  }

  const field = (key: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="text-xs text-gray-600">
      {label}
      <input className={`input-field mt-1 ${errors[key] ? "input-field-error" : ""}`} value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
      {errors[key] && <span className="mt-1 block text-red-600">{errors[key]}</span>}
    </label>
  );

  if (duplicates) {
    return (
      <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm text-amber-900">Já existem clientes parecidos na sua carteira:</p>
        <ul className="space-y-1">
          {duplicates.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{d.tradeName || d.contactName}{d.seller?.name && <span className="text-xs text-gray-500"> · {d.seller.name}</span>}</span>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => onCreated({ id: d.id, name: d.tradeName || d.contactName })}>Usar este</button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => submit(true)}>Cadastrar mesmo assim</button>
          <button type="button" className="btn-secondary" onClick={() => setDuplicates(null)}>Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-3 rounded-md border border-gray-200 p-3" onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
      <p className="text-sm font-medium text-gray-800">Cadastro rápido de cliente</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("contactName", "Nome do contato *", { required: true, autoComplete: "name" })}
        {field("tradeName", "Empresa (nome fantasia)")}
        {field("document", "CNPJ ou CPF", { inputMode: "numeric" })}
        {field("phone", "WhatsApp/telefone", { inputMode: "tel" })}
        {field("email", "E-mail", { type: "email" })}
      </div>
      {message && <p className="text-xs text-red-600">{message}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || form.contactName.trim().length === 0}>{busy ? "Cadastrando..." : "Cadastrar e usar"}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancelar</button>
      </div>
      <p className="text-[11px] text-gray-500">Os demais dados podem ser completados depois no perfil do cliente.</p>
    </form>
  );
}
