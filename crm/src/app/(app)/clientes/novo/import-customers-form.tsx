"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SellerOption {
  id: string;
  name: string;
}

interface ImportIssue {
  rowNumber: number;
  message: string;
}

interface PreviewRow {
  rowNumber: number;
  contactName: string;
  tradeName: string | null;
  cnpjDigits: string | null;
  email: string | null;
  phoneDigits: string | null;
  city: string | null;
  state: string | null;
  spRegion: string | null;
  businessType: string | null;
  industrySegment: string | null;
  worksWithSmartwatch: boolean | null;
  interests: string[];
  interestedBrand: string | null;
  leadCapturedAt: string | null;
}

interface PreviewResult {
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  mergeableDuplicateCount: number;
  duplicates: Array<{ rowNumber: number; incomingName: string; existing: { id: string; name: string; legalName: string | null; sellerName: string }; matchedBy: string[] }>;
  issues: ImportIssue[];
  previewRows: PreviewRow[];
  seller: { id: string; name: string };
}

export function ImportCustomersForm({ sellers, currentUserId }: { sellers: SellerOption[]; currentUserId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [sellerId, setSellerId] = useState(
    sellers.some((seller) => seller.id === currentUserId) ? currentUserId : (sellers[0]?.id ?? "")
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeDuplicates, setMergeDuplicates] = useState(false);
  const [result, setResult] = useState<{ createdCount: number; mergedCount: number; invalidCount: number; duplicateCount: number } | null>(null);

  async function send(action: "preview" | "import") {
    if (!file) {
      setError("Selecione uma planilha CSV ou XLSX.");
      return;
    }
    setLoading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    body.set("action", action);
    body.set("sellerId", sellerId);
    body.set("mergeDuplicates", String(mergeDuplicates));
    try {
      const response = await fetch("/api/customers/import", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Não foi possível processar a planilha.");
        return;
      }
      if (action === "preview") {
        setPreview(data);
        setResult(null);
      } else {
        setResult(data);
        setPreview(null);
        router.refresh();
      }
    } catch {
      setError("Erro de rede ao enviar a planilha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Campo obrigatório em todas as linhas:</p>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li><strong>Nome do cliente</strong> — colunas aceitas: Nome, Cliente ou Nome do contato.</li>
        </ul>
        <p className="mt-2">
          Aceitamos arquivos <strong>CSV</strong> e <strong>XLSX</strong>, com até 1.000 clientes e 5 MB.
          Linhas sem nome ou inválidas serão ignoradas. Duplicados serão mostrados antes da importação e poderão ser fundidos.
        </p>
        <p className="mt-2"><strong>WhatsApp/Número é opcional.</strong> Quando informado, aceita as colunas WhatsApp, Whats, Telefone ou Celular.</p>
        <p className="mt-2"><strong>Dois números adicionais opcionais:</strong> use Telefone 2 e Telefone 3 (também aceita WhatsApp 2/3 ou Celular 2/3). Informe apenas DDD + número, sem precisar escolher o tipo.</p>
        <p className="mt-2"><strong>Estado é opcional</strong> e pode vir em uma coluna chamada UF, Estado ou State. O valor deve ter duas letras, como SP ou MG.</p>
        <p className="mt-2"><strong>Região de SP é opcional</strong> e pode vir nas colunas Região, Região SP, Região de SP ou Regional. Se houver região sem Estado, o sistema define SP automaticamente.</p>
        <p className="mt-2">Também reconhecemos: <strong>Carimbo de data/hora, Empresa, Tipo de negócio, Segmento de atuação, Já trabalha com Smartwatch, Interesse e Empresa de interesse</strong>.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label-field">Planilha de clientes *</label>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="input-field"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
              setMergeDuplicates(false);
              setError(null);
            }}
          />
        </div>
        {sellers.length > 1 && (
          <div>
            <label className="label-field">Responsável pelos clientes *</label>
            <select
              className="input-field"
              value={sellerId}
              onChange={(event) => {
                setSellerId(event.target.value);
                setPreview(null);
              }}
            >
              {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" disabled={!file || !sellerId || loading} onClick={() => send("preview")}>
          {loading ? "Analisando..." : "Analisar planilha"}
        </button>
        <a className="btn-secondary" href="/modelo-importacao-clientes.csv" download>
          Baixar modelo padrão
        </a>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-medium">Importação concluída: {result.createdCount} cliente(s) criado(s).</p>
          {result.mergedCount > 0 && <p className="mt-1">{result.mergedCount} cliente(s) existente(s) receberam as informações que estavam faltando.</p>}
          {(result.invalidCount > 0 || result.duplicateCount > result.mergedCount) && (
            <p className="mt-1">Ignorados: {result.invalidCount} inválido(s) e {result.duplicateCount - result.mergedCount} duplicado(s) não fundido(s).</p>
          )}
          <button type="button" className="mt-3 underline font-medium" onClick={() => router.push("/clientes")}>Ver clientes</button>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-md bg-green-50 border border-green-200 p-3"><strong className="block text-lg text-green-700">{preview.validCount}</strong>prontos</div>
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3"><strong className="block text-lg text-amber-700">{preview.duplicateCount}</strong>duplicados</div>
            <div className="rounded-md bg-red-50 border border-red-200 p-3"><strong className="block text-lg text-red-700">{preview.invalidCount}</strong>inválidos</div>
          </div>
          <p className="text-sm text-gray-600">Os clientes válidos serão atribuídos a <strong>{preview.seller.name}</strong>.</p>

          {preview.duplicates.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">Duplicados encontrados</p>
              <ul className="mt-2 space-y-2 text-amber-900">
                {preview.duplicates.map((duplicate) => <li key={`${duplicate.rowNumber}-${duplicate.existing.id}`}>
                  Linha {duplicate.rowNumber}: <strong>{duplicate.incomingName}</strong> coincide por {duplicate.matchedBy.join(", ")} com <strong>{duplicate.existing.name}</strong> ({duplicate.existing.sellerName}).
                </li>)}
              </ul>
              <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-300 bg-white p-3 font-medium">
                <input type="checkbox" className="mt-1" checked={mergeDuplicates} onChange={(event) => setMergeDuplicates(event.target.checked)} />
                Fundir informações: preencher somente os campos vazios dos clientes existentes e manter histórico, vendedor, propostas e vendas.
              </label>
            </div>
          )}

          {preview.previewRows.length > 0 && (
            <div className="overflow-x-auto border rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600"><tr><th className="p-2">Linha</th><th className="p-2">Cliente</th><th className="p-2">Contato</th><th className="p-2">Cidade/UF</th><th className="p-2">Região de SP</th><th className="p-2">Perfil comercial</th></tr></thead>
                <tbody className="divide-y">
                  {preview.previewRows.map((row) => (
                    <tr key={row.rowNumber}><td className="p-2">{row.rowNumber}</td><td className="p-2">{row.tradeName || row.contactName}</td><td className="p-2">{row.email || row.phoneDigits || "—"}</td><td className="p-2">{[row.city, row.state].filter(Boolean).join("/") || "—"}</td><td className="p-2">{row.spRegion || "—"}</td><td className="p-2"><div>{row.industrySegment || "—"}</div><div className="text-xs text-gray-400">{row.interestedBrand || row.interests.join(", ")}</div></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.issues.length > 0 && (
            <details className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <summary className="cursor-pointer font-medium text-amber-900">Ver linhas ignoradas ({preview.issues.length})</summary>
              <ul className="mt-2 space-y-1 text-amber-800">
                {preview.issues.map((issue, index) => <li key={`${issue.rowNumber}-${index}`}>Linha {issue.rowNumber}: {issue.message}</li>)}
              </ul>
            </details>
          )}

          <button type="button" className="btn-primary" disabled={loading || (preview.validCount === 0 && !mergeDuplicates)} onClick={() => send("import")}>
            {loading ? "Importando..." : `Importar ${preview.validCount} e fundir ${mergeDuplicates ? preview.mergeableDuplicateCount : 0}`}
          </button>
        </div>
      )}
    </div>
  );
}
