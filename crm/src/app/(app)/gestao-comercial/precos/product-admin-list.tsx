"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ProductRow {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  active: boolean;
  variants: Array<{ id: string; sku: string; colorName: string; active: boolean }>;
}

/** Ativar/desativar e renomear produtos e cores. SKU é somente leitura (chave do Olist). */
export function ProductAdminList({ products }: { products: ProductRow[] }) {
  return (
    <div className="divide-y divide-gray-200">
      {products.map((p) => <ProductEditor key={p.id} product={p} />)}
    </div>
  );
}

function ProductEditor({ product }: { product: ProductRow }) {
  const router = useRouter();
  const [form, setForm] = useState(() => ({
    name: product.name,
    category: product.category,
    imageUrl: product.imageUrl ?? "",
    active: product.active,
    variants: product.variants.map((v) => ({ ...v })),
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const dirty =
    form.name !== product.name ||
    form.category !== product.category ||
    form.imageUrl !== (product.imageUrl ?? "") ||
    form.active !== product.active ||
    form.variants.some((v, i) => v.colorName !== product.variants[i].colorName || v.active !== product.variants[i].active);

  async function save() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/commercial/products/${product.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        category: form.category,
        imageUrl: form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
        active: form.active,
        variants: form.variants.map((v) => ({ id: v.id, colorName: v.colorName, active: v.active })),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      const fields = data.details?.fieldErrors as Record<string, string[]> | undefined;
      const first = fields ? Object.values(fields).flat()[0] : null;
      return setMessage({ tone: "error", text: first || data.error || "Não foi possível salvar." });
    }
    setMessage({ tone: "ok", text: "Produto atualizado." });
    router.refresh();
  }

  return (
    <details className="group py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="text-sm font-medium text-gray-800">
          {product.name}
          <span className="ml-2 text-xs font-normal text-gray-500">{product.variants.length} cor(es)</span>
        </span>
        <span className={`badge ${product.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"}`}>
          {product.active ? "Ativo" : "Inativo"}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-600">Nome comercial
            <input className="input-field mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600">Categoria
            <input className="input-field mt-1" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </label>
          <label className="text-xs text-gray-600">Imagem (URL https)
            <input className="input-field mt-1" value={form.imageUrl} placeholder="https://cdn.shopify.com/..."
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Produto disponível para cotação
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr><th className="py-1 font-medium">SKU (Olist)</th><th className="py-1 font-medium">Cor</th><th className="py-1 font-medium">Disponível</th></tr>
            </thead>
            <tbody>
              {form.variants.map((v, i) => (
                <tr key={v.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-mono text-xs text-gray-600">{v.sku}</td>
                  <td className="py-1.5 pr-2">
                    <input className="input-field" value={v.colorName}
                      onChange={(e) => setForm({ ...form, variants: form.variants.map((x, j) => (j === i ? { ...x, colorName: e.target.value } : x)) })} />
                  </td>
                  <td className="py-1.5">
                    <input type="checkbox" aria-label={`${v.sku} disponível`} checked={v.active}
                      onChange={(e) => setForm({ ...form, variants: form.variants.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? "Salvando..." : "Salvar produto"}</button>
          {message && <span className={`text-xs ${message.tone === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</span>}
        </div>
      </div>
    </details>
  );
}
