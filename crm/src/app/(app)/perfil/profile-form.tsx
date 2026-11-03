"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ProfileForm({
  initialName,
  initialPhone,
  initialWhatsapp,
}: {
  initialName: string;
  initialPhone: string;
  initialWhatsapp: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, whatsapp }),
    });
    setLoading(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="label-field">Nome</label>
        <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label-field">Telefone</label>
        <input className="input-field" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div>
        <label className="label-field">WhatsApp</label>
        <input className="input-field" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
      </div>
      {saved && <p className="text-sm text-green-600">Perfil atualizado.</p>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
