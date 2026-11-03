"use client";
import React from "react";
export function CustomerPhoneField({ label, value, onValue, error, inputRef }: {
  label: string; value: string; onValue: (value: string) => void;
  error?: string; inputRef?: (node: HTMLInputElement | null) => void;
}) {
  return <div>
    <label className="label-field">{label} (opcional)
      <input ref={inputRef} type="tel" className={error ? "input-field input-field-error" : "input-field"} value={value} onChange={(event) => onValue(event.target.value)} aria-invalid={Boolean(error)} placeholder="DDD + número" />
    </label>
    {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
  </div>;
}
