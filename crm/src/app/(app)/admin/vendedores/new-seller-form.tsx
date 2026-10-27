"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewSellerForm({ supervisors }: { supervisors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("VENDEDOR");
  const [supervisorId, setSupervisorId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        supervisorId: supervisorId || null,
        jobTitle: jobTitle || null,
        phone: phone || null,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Erro ao criar usuário.");
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setJobTitle("");
    setPhone("");
    const result = await res.json().catch(() => ({}));
    setMessage(result.centralAccess?.warning || (result.centralAccess?.status === 'LINKED'
      ? 'Conta criada e vinculada. Use o e-mail e a senha do Atendimento nos dois sistemas.'
      : 'Conta criada.'));
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <input className="input-field" placeholder="Nome" required value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="input-field"
        placeholder="E-mail"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="input-field"
        placeholder="Senha inicial (mín. 8 caracteres)"
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <select className="input-field" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="VENDEDOR">Vendedor</option>
        <option value="REPRESENTANTE">Representante</option>
        <option value="SUPERVISOR">Supervisor</option>
        <option value="ADMIN">Administrador</option>
      </select>
      <select className="input-field" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
        <option value="">Sem supervisor</option>
        {supervisors.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        className="input-field"
        placeholder="Cargo (opcional)"
        value={jobTitle}
        onChange={(e) => setJobTitle(e.target.value)}
      />
      <input
        className="input-field"
        placeholder="Telefone (opcional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      {message && <p role="status" className="text-sm sm:col-span-2">{message}</p>}
      <button type="submit" className="btn-primary sm:col-span-2" disabled={loading}>
        {loading ? "Criando..." : "Criar usuário"}
      </button>
    </form>
  );
}
