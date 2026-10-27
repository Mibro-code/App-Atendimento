"use client";

import { useState } from "react";
import {signOut} from 'next-auth/react';

export function ChangePasswordForm({sharedPassword=false}:{sharedPassword?:boolean}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }

    setLoading(true);
    try{
    const res = await fetch("/api/profile/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error || "Não foi possível alterar a senha.");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(true);
    if(data.reauthenticate){
      // Server already revoked every old primary session in both systems.
      // Best-effort cookie cleanup cannot turn a successful change into failure.
      try{await signOut({redirect:false});}catch{/* The revoked session cannot authenticate. */}
      window.location.assign('/login?passwordChanged=1');
    }
    }catch{
      setError('Não foi possível confirmar a troca. Tente entrar com a nova senha antes de repetir a operação.');
    }finally{setLoading(false);}
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {sharedPassword && <p className="text-sm text-gray-600">Esta é sua senha geral do CRM e do Atendimento. Informe a senha atual do Atendimento. Após alterar, será necessário entrar novamente nos dois apps. Uma redefinição posterior pelo Master substitui esta senha.</p>}
      <div>
        <label className="label-field" htmlFor="profile-current-password">Senha atual</label>
        <input
          id="profile-current-password"
          autoComplete="current-password"
          className="input-field"
          type="password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div>
        <label className="label-field" htmlFor="profile-new-password">Nova senha</label>
        <input
          id="profile-new-password"
          autoComplete="new-password"
          className="input-field"
          type="password"
          required
          minLength={8}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </div>
      <div>
        <label className="label-field" htmlFor="profile-confirm-password">Confirmar nova senha</label>
        <input
          id="profile-confirm-password"
          autoComplete="new-password"
          className="input-field"
          type="password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Senha alterada com sucesso.</p>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Alterando..." : "Alterar senha"}
      </button>
    </form>
  );
}
