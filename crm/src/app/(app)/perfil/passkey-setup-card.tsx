"use client";

import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";

export function PasskeySetupCard({ count }: { count: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function register() {
    setLoading(true);
    setMessage(null);
    try {
      const optionsResponse = await fetch("/api/profile/passkeys/register/options", { method: "POST" });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error || "Não foi possível iniciar o cadastro.");
      const credential = await startRegistration(options);
      const verifyResponse = await fetch("/api/profile/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      });
      const result = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok) throw new Error(result.error || "Não foi possível confirmar a digital/passkey.");
      setMessage("Digital/passkey cadastrada com sucesso.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error && error.name !== "NotAllowedError" ? error.message : "Cadastro cancelado ou não autorizado no aparelho.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="card p-6 space-y-3">
    <div>
      <h2 className="text-sm font-semibold text-gray-800">Digital ou passkey para o ponto</h2>
      <p className="mt-1 text-sm text-gray-500">Cadastre a proteção do aparelho. No celular, normalmente será solicitada a digital ou o reconhecimento facial; no computador, Windows Hello ou outra passkey compatível.</p>
    </div>
    <p className="text-xs text-gray-500">Credenciais cadastradas: {count}. A biometria nunca é enviada ao CRM; o aparelho confirma sua identidade com WebAuthn.</p>
    <button type="button" className="btn-secondary" disabled={loading} onClick={register}>{loading ? "Aguardando o aparelho..." : count ? "Adicionar outra passkey" : "Cadastrar digital/passkey"}</button>
    {message && <p className="text-sm text-gray-600">{message}</p>}
  </div>;
}
