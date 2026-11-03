"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TeamMemberForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"VENDEDOR" | "REPRESENTANTE">("VENDEDOR");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    const body = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(body.error || "Não foi possível criar a conta.");
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setMessage(body.centralAccess?.warning || (body.centralAccess?.status === 'LINKED'
      ? 'Conta criada e vinculada ao Atendimento. Use o e-mail e a senha do Atendimento nos dois sistemas.'
      : 'Conta criada e vinculada à sua equipe.'));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-800">Adicionar integrante</h2>
        <p className="mt-1 text-xs text-gray-500">A nova conta será vinculada automaticamente à sua equipe.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input className="input-field" required minLength={2} placeholder="Nome" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="input-field" required type="email" placeholder="E-mail" value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className="input-field" required type="password" minLength={8} placeholder="Senha inicial (mín. 8 caracteres)" value={password} onChange={(event) => setPassword(event.target.value)} />
        <select className="input-field" value={role} onChange={(event) => setRole(event.target.value as "VENDEDOR" | "REPRESENTANTE")}>
          <option value="VENDEDOR">Vendedor</option>
          <option value="REPRESENTANTE">Representante</option>
        </select>
      </div>
      {message && <p className="text-sm text-gray-600">{message}</p>}
      <button className="btn-primary" type="submit" disabled={loading}>{loading ? "Criando..." : "Criar conta"}</button>
    </form>
  );
}
