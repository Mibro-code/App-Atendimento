import { useEffect } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

const DEFAULT_SETTINGS = {
  referralDiscountType: "PERCENTAGE",
  referralDiscountValue: 15,
  referralDurationDays: 30,
  referralTotalUsageLimit: "",
  referralUsageLimitPerCustomer: 1,
  referralMinimumPurchase: 100,
  referralEligibleProducts: "",
  referralEligibleCollections: "",
  referralCombinesProductDiscount: false,
  referralCombinesOrderDiscount: false,
  referralCombinesShipping: false,
  referralAllowsGuest: false,

  rewardDiscountType: "PERCENTAGE",
  rewardDiscountValue: 10,
  rewardDurationDays: 30,
  rewardUsageLimit: 1,
  rewardMinimumPurchase: 100,
  rewardCreatorExclusive: true,
  rewardEligibleProducts: "",
  rewardEligibleCollections: "",
  rewardCombinesProductDiscount: false,
  rewardCombinesOrderDiscount: false,
  rewardCombinesShipping: false,

  rewardReleaseMoment: "PAID",
  rewardWaitingDays: 0,
  refundRule: "CANCEL_REWARD",
  monthlyRewardLimit: 10,
  allowMultipleProgramCoupons: true,
  excludeGiftCards: true,
  requirePaidOrder: true,
  requireAuthenticatedCustomer: true,
  preventSelfReferral: true,
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const settings = await db.couponSettings.findUnique({
    where: {
      shop: session.shop,
    },
  });

  return {
    settings: settings ?? DEFAULT_SETTINGS,
  };
}

function formHas(formData, fieldName) {
  return formData.get(fieldName) === "on";
}

function numberValue(formData, fieldName, fallback = 0) {
  const rawValue = formData.get(fieldName);

  if (rawValue === null || rawValue === "") {
    return fallback;
  }

  const value = Number(rawValue);

  return Number.isFinite(value) ? value : fallback;
}

function optionalInteger(formData, fieldName) {
  const rawValue = formData.get(fieldName);

  if (rawValue === null || rawValue === "") {
    return null;
  }

  const value = Number(rawValue);

  return Number.isInteger(value) ? value : null;
}

function textValue(formData, fieldName, fallback = "") {
  const value = formData.get(fieldName);

  return typeof value === "string" ? value.trim() : fallback;
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();

  try {
    await db.couponSettings.upsert({
      where: {
        shop: session.shop,
      },

      create: {
        shop: session.shop,

        referralDiscountType: textValue(
          formData,
          "referralDiscountType",
          "PERCENTAGE",
        ),
        referralDiscountValue: numberValue(
          formData,
          "referralDiscountValue",
          15,
        ),
        referralDurationDays: numberValue(
          formData,
          "referralDurationDays",
          30,
        ),
        referralTotalUsageLimit: optionalInteger(
          formData,
          "referralTotalUsageLimit",
        ),
        referralUsageLimitPerCustomer: numberValue(
          formData,
          "referralUsageLimitPerCustomer",
          1,
        ),
        referralMinimumPurchase: numberValue(
          formData,
          "referralMinimumPurchase",
          100,
        ),
        referralEligibleProducts: textValue(
          formData,
          "referralEligibleProducts",
        ),
        referralEligibleCollections: textValue(
          formData,
          "referralEligibleCollections",
        ),
        referralCombinesProductDiscount: formHas(
          formData,
          "referralCombinesProductDiscount",
        ),
        referralCombinesOrderDiscount: formHas(
          formData,
          "referralCombinesOrderDiscount",
        ),
        referralCombinesShipping: formHas(
          formData,
          "referralCombinesShipping",
        ),
        referralAllowsGuest: formHas(formData, "referralAllowsGuest"),

        rewardDiscountType: textValue(
          formData,
          "rewardDiscountType",
          "PERCENTAGE",
        ),
        rewardDiscountValue: numberValue(
          formData,
          "rewardDiscountValue",
          10,
        ),
        rewardDurationDays: numberValue(
          formData,
          "rewardDurationDays",
          30,
        ),
        rewardUsageLimit: numberValue(formData, "rewardUsageLimit", 1),
        rewardMinimumPurchase: numberValue(
          formData,
          "rewardMinimumPurchase",
          100,
        ),
        rewardCreatorExclusive: formHas(
          formData,
          "rewardCreatorExclusive",
        ),
        rewardEligibleProducts: textValue(
          formData,
          "rewardEligibleProducts",
        ),
        rewardEligibleCollections: textValue(
          formData,
          "rewardEligibleCollections",
        ),
        rewardCombinesProductDiscount: formHas(
          formData,
          "rewardCombinesProductDiscount",
        ),
        rewardCombinesOrderDiscount: formHas(
          formData,
          "rewardCombinesOrderDiscount",
        ),
        rewardCombinesShipping: formHas(
          formData,
          "rewardCombinesShipping",
        ),

        rewardReleaseMoment: textValue(
          formData,
          "rewardReleaseMoment",
          "PAID",
        ),
        rewardWaitingDays: numberValue(
          formData,
          "rewardWaitingDays",
          0,
        ),
        refundRule: textValue(
          formData,
          "refundRule",
          "CANCEL_REWARD",
        ),
        monthlyRewardLimit: numberValue(
          formData,
          "monthlyRewardLimit",
          10,
        ),
        allowMultipleProgramCoupons: formHas(
          formData,
          "allowMultipleProgramCoupons",
        ),
        excludeGiftCards: formHas(formData, "excludeGiftCards"),
        requirePaidOrder: formHas(formData, "requirePaidOrder"),
        requireAuthenticatedCustomer: formHas(
          formData,
          "requireAuthenticatedCustomer",
        ),
        preventSelfReferral: formHas(formData, "preventSelfReferral"),
      },

      update: {
        referralDiscountType: textValue(
          formData,
          "referralDiscountType",
          "PERCENTAGE",
        ),
        referralDiscountValue: numberValue(
          formData,
          "referralDiscountValue",
          15,
        ),
        referralDurationDays: numberValue(
          formData,
          "referralDurationDays",
          30,
        ),
        referralTotalUsageLimit: optionalInteger(
          formData,
          "referralTotalUsageLimit",
        ),
        referralUsageLimitPerCustomer: numberValue(
          formData,
          "referralUsageLimitPerCustomer",
          1,
        ),
        referralMinimumPurchase: numberValue(
          formData,
          "referralMinimumPurchase",
          100,
        ),
        referralEligibleProducts: textValue(
          formData,
          "referralEligibleProducts",
        ),
        referralEligibleCollections: textValue(
          formData,
          "referralEligibleCollections",
        ),
        referralCombinesProductDiscount: formHas(
          formData,
          "referralCombinesProductDiscount",
        ),
        referralCombinesOrderDiscount: formHas(
          formData,
          "referralCombinesOrderDiscount",
        ),
        referralCombinesShipping: formHas(
          formData,
          "referralCombinesShipping",
        ),
        referralAllowsGuest: formHas(formData, "referralAllowsGuest"),

        rewardDiscountType: textValue(
          formData,
          "rewardDiscountType",
          "PERCENTAGE",
        ),
        rewardDiscountValue: numberValue(
          formData,
          "rewardDiscountValue",
          10,
        ),
        rewardDurationDays: numberValue(
          formData,
          "rewardDurationDays",
          30,
        ),
        rewardUsageLimit: numberValue(formData, "rewardUsageLimit", 1),
        rewardMinimumPurchase: numberValue(
          formData,
          "rewardMinimumPurchase",
          100,
        ),
        rewardCreatorExclusive: formHas(
          formData,
          "rewardCreatorExclusive",
        ),
        rewardEligibleProducts: textValue(
          formData,
          "rewardEligibleProducts",
        ),
        rewardEligibleCollections: textValue(
          formData,
          "rewardEligibleCollections",
        ),
        rewardCombinesProductDiscount: formHas(
          formData,
          "rewardCombinesProductDiscount",
        ),
        rewardCombinesOrderDiscount: formHas(
          formData,
          "rewardCombinesOrderDiscount",
        ),
        rewardCombinesShipping: formHas(
          formData,
          "rewardCombinesShipping",
        ),

        rewardReleaseMoment: textValue(
          formData,
          "rewardReleaseMoment",
          "PAID",
        ),
        rewardWaitingDays: numberValue(
          formData,
          "rewardWaitingDays",
          0,
        ),
        refundRule: textValue(
          formData,
          "refundRule",
          "CANCEL_REWARD",
        ),
        monthlyRewardLimit: numberValue(
          formData,
          "monthlyRewardLimit",
          10,
        ),
        allowMultipleProgramCoupons: formHas(
          formData,
          "allowMultipleProgramCoupons",
        ),
        excludeGiftCards: formHas(formData, "excludeGiftCards"),
        requirePaidOrder: formHas(formData, "requirePaidOrder"),
        requireAuthenticatedCustomer: formHas(
          formData,
          "requireAuthenticatedCustomer",
        ),
        preventSelfReferral: formHas(formData, "preventSelfReferral"),
      },
    });

    return {
      success: true,
      message: "Configurações salvas com sucesso.",
    };
  } catch (error) {
    console.error("Erro ao salvar configurações:", error);

    return {
      success: false,
      message: "Não foi possível salvar as configurações.",
    };
  }
}

function Field({ label, explanation, children }) {
  return (
    <div className="coupon-field">
      <div className="coupon-label">{label}</div>
      <div className="coupon-explanation">{explanation}</div>
      <div className="coupon-control">{children}</div>
    </div>
  );
}

function NumberInput({
  name,
  defaultValue,
  min = 0,
  step = 1,
  placeholder,
}) {
  return (
    <input
      className="coupon-input"
      type="number"
      name={name}
      defaultValue={defaultValue ?? ""}
      min={min}
      step={step}
      placeholder={placeholder}
    />
  );
}

function TextInput({ name, defaultValue, placeholder }) {
  return (
    <input
      className="coupon-input"
      type="text"
      name={name}
      defaultValue={defaultValue ?? ""}
      placeholder={placeholder}
    />
  );
}

function SelectInput({ name, defaultValue, children }) {
  return (
    <select
      className="coupon-input"
      name={name}
      defaultValue={defaultValue}
    >
      {children}
    </select>
  );
}

function CheckboxInput({ name, defaultChecked, label }) {
  return (
    <label className="coupon-checkbox">
      <input
        type="checkbox"
        name={name}
        defaultChecked={Boolean(defaultChecked)}
      />
      <span>{label}</span>
    </label>
  );
}

export default function CouponSettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const isSaving = navigation.state === "submitting";

  useEffect(() => {
    if (!actionData?.message) return;

    if (window.shopify?.toast) {
      window.shopify.toast.show(actionData.message, {
        isError: !actionData.success,
      });
    }
  }, [actionData]);

  return (
    <s-page heading="Configurações de cupons">
      <style>{`
        .coupon-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
          padding-bottom: 40px;
        }

        .coupon-card {
          background: #ffffff;
          border: 1px solid #e1e3e5;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
        }

        .coupon-card h2 {
          margin: 0 0 6px;
          font-size: 20px;
          line-height: 1.3;
        }

        .coupon-card-description {
          margin: 0 0 20px;
          color: #616161;
          line-height: 1.5;
        }

        .coupon-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }

        .coupon-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .coupon-field-full {
          grid-column: 1 / -1;
        }

        .coupon-label {
          font-weight: 600;
          color: #303030;
        }

        .coupon-explanation {
          min-height: 34px;
          color: #616161;
          font-size: 13px;
          line-height: 1.35;
        }

        .coupon-control {
          margin-top: 3px;
        }

        .coupon-input {
          box-sizing: border-box;
          width: 100%;
          min-height: 38px;
          padding: 8px 10px;
          color: #303030;
          background: #ffffff;
          border: 1px solid #8a8a8a;
          border-radius: 8px;
          font: inherit;
        }

        .coupon-input:focus {
          border-color: #005bd3;
          outline: 2px solid rgba(0, 91, 211, 0.2);
        }

        .coupon-checkboxes {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 6px;
        }

        .coupon-checkbox {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          cursor: pointer;
          line-height: 1.4;
        }

        .coupon-checkbox input {
          width: 18px;
          height: 18px;
          margin: 1px 0 0;
        }

        .coupon-message {
          padding: 12px 14px;
          border-radius: 8px;
          font-weight: 600;
        }

        .coupon-message-success {
          color: #174d2b;
          background: #e8f5ec;
          border: 1px solid #a7d7b5;
        }

        .coupon-message-error {
          color: #8e1f0b;
          background: #fff0ed;
          border: 1px solid #f0b4a8;
        }

        .coupon-actions {
          position: sticky;
          bottom: 0;
          display: flex;
          justify-content: flex-end;
          padding: 14px 0;
          background: rgba(246, 246, 247, 0.95);
          backdrop-filter: blur(8px);
        }

        .coupon-save-button {
          min-height: 40px;
          padding: 9px 18px;
          color: #ffffff;
          background: #303030;
          border: 0;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
        }

        .coupon-save-button:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }

        @media (max-width: 760px) {
          .coupon-grid {
            grid-template-columns: 1fr;
          }

          .coupon-field-full {
            grid-column: auto;
          }
        }
      `}</style>

      <Form method="post" className="coupon-form">
        {actionData?.message && (
          <div
            className={`coupon-message ${
              actionData.success
                ? "coupon-message-success"
                : "coupon-message-error"
            }`}
          >
            {actionData.message}
          </div>
        )}

        <section className="coupon-card">
          <h2>Cupom de indicação</h2>

          <p className="coupon-card-description">
            Configura o desconto compartilhado pelo cliente que participa do
            programa de indicação.
          </p>

          <div className="coupon-grid">
            <Field
              label="Tipo do desconto"
              explanation="Define se o benefício será uma porcentagem ou um valor fixo em reais."
            >
              <SelectInput
                name="referralDiscountType"
                defaultValue={settings.referralDiscountType}
              >
                <option value="PERCENTAGE">Porcentagem</option>
                <option value="FIXED_AMOUNT">Valor fixo</option>
              </SelectInput>
            </Field>

            <Field
              label="Valor"
              explanation="Define o valor ou percentual oferecido pelo cupom de indicação."
            >
              <NumberInput
                name="referralDiscountValue"
                defaultValue={settings.referralDiscountValue}
                step="0.01"
              />
            </Field>

            <Field
              label="Duração"
              explanation="Define por quantos dias o cupom ficará disponível após ser criado."
            >
              <NumberInput
                name="referralDurationDays"
                defaultValue={settings.referralDurationDays}
              />
            </Field>

            <Field
              label="Limite total de usos"
              explanation="Define quantas vezes o código poderá ser usado no total por pessoas diferentes. Deixe vazio para não limitar."
            >
              <NumberInput
                name="referralTotalUsageLimit"
                defaultValue={settings.referralTotalUsageLimit}
                placeholder="Sem limite"
              />
            </Field>

            <Field
              label="Limite por comprador"
              explanation="Define quantas vezes a mesma pessoa poderá usar esse cupom."
            >
              <NumberInput
                name="referralUsageLimitPerCustomer"
                defaultValue={settings.referralUsageLimitPerCustomer}
              />
            </Field>

            <Field
              label="Valor mínimo"
              explanation="Define o valor mínimo do pedido necessário para aplicar o desconto."
            >
              <NumberInput
                name="referralMinimumPurchase"
                defaultValue={settings.referralMinimumPurchase}
                step="0.01"
              />
            </Field>

            <div className="coupon-field-full">
              <Field
                label="Produtos elegíveis"
                explanation="Informe produtos específicos. Deixe vazio para permitir todos os produtos."
              >
                <TextInput
                  name="referralEligibleProducts"
                  defaultValue={settings.referralEligibleProducts}
                  placeholder="Todos os produtos"
                />
              </Field>
            </div>

            <div className="coupon-field-full">
              <Field
                label="Coleções elegíveis"
                explanation="Informe coleções específicas. Deixe vazio para permitir todas as coleções."
              >
                <TextInput
                  name="referralEligibleCollections"
                  defaultValue={settings.referralEligibleCollections}
                  placeholder="Todas as coleções"
                />
              </Field>
            </div>

            <div className="coupon-field-full">
              <Field
                label="Combinações"
                explanation="Define com quais tipos de desconto o cupom de indicação poderá ser combinado."
              >
                <div className="coupon-checkboxes">
                  <CheckboxInput
                    name="referralCombinesProductDiscount"
                    defaultChecked={
                      settings.referralCombinesProductDiscount
                    }
                    label="Combinar com descontos de produtos"
                  />

                  <CheckboxInput
                    name="referralCombinesOrderDiscount"
                    defaultChecked={settings.referralCombinesOrderDiscount}
                    label="Combinar com descontos do pedido"
                  />

                  <CheckboxInput
                    name="referralCombinesShipping"
                    defaultChecked={settings.referralCombinesShipping}
                    label="Combinar com desconto de frete"
                  />
                </div>
              </Field>
            </div>

            <div className="coupon-field-full">
              <CheckboxInput
                name="referralAllowsGuest"
                defaultChecked={settings.referralAllowsGuest}
                label="Permitir que compradores sem login utilizem o cupom"
              />
            </div>
          </div>
        </section>

        <section className="coupon-card">
          <h2>Cupom de recompensa</h2>

          <p className="coupon-card-description">
            Configura o cupom recebido pelo cliente que realizou uma indicação
            válida.
          </p>

          <div className="coupon-grid">
            <Field
              label="Tipo do desconto"
              explanation="Define se a recompensa será uma porcentagem ou um valor fixo."
            >
              <SelectInput
                name="rewardDiscountType"
                defaultValue={settings.rewardDiscountType}
              >
                <option value="PERCENTAGE">Porcentagem</option>
                <option value="FIXED_AMOUNT">Valor fixo</option>
              </SelectInput>
            </Field>

            <Field
              label="Valor"
              explanation="Define o valor ou percentual recebido pelo cliente que realizou a indicação."
            >
              <NumberInput
                name="rewardDiscountValue"
                defaultValue={settings.rewardDiscountValue}
                step="0.01"
              />
            </Field>

            <Field
              label="Duração"
              explanation="Define por quantos dias a recompensa ficará disponível após ser liberada."
            >
              <NumberInput
                name="rewardDurationDays"
                defaultValue={settings.rewardDurationDays}
              />
            </Field>

            <Field
              label="Quantidade de usos"
              explanation="Define quantas vezes o cupom de recompensa poderá ser utilizado."
            >
              <NumberInput
                name="rewardUsageLimit"
                defaultValue={settings.rewardUsageLimit}
              />
            </Field>

            <Field
              label="Valor mínimo"
              explanation="Define o valor mínimo necessário para utilizar o cupom de recompensa."
            >
              <NumberInput
                name="rewardMinimumPurchase"
                defaultValue={settings.rewardMinimumPurchase}
                step="0.01"
              />
            </Field>

            <div className="coupon-field-full">
              <Field
                label="Produtos elegíveis"
                explanation="Informe os produtos que poderão receber a recompensa. Deixe vazio para permitir todos."
              >
                <TextInput
                  name="rewardEligibleProducts"
                  defaultValue={settings.rewardEligibleProducts}
                  placeholder="Todos os produtos"
                />
              </Field>
            </div>

            <div className="coupon-field-full">
              <Field
                label="Coleções elegíveis"
                explanation="Informe as coleções que poderão receber a recompensa. Deixe vazio para permitir todas."
              >
                <TextInput
                  name="rewardEligibleCollections"
                  defaultValue={settings.rewardEligibleCollections}
                  placeholder="Todas as coleções"
                />
              </Field>
            </div>

            <div className="coupon-field-full">
              <CheckboxInput
                name="rewardCreatorExclusive"
                defaultChecked={settings.rewardCreatorExclusive}
                label="Restringir o cupom de recompensa ao cliente que realizou a indicação"
              />
            </div>

            <div className="coupon-field-full">
              <Field
                label="Combinações permitidas"
                explanation="Define com quais tipos de desconto a recompensa poderá ser combinada."
              >
                <div className="coupon-checkboxes">
                  <CheckboxInput
                    name="rewardCombinesProductDiscount"
                    defaultChecked={
                      settings.rewardCombinesProductDiscount
                    }
                    label="Combinar com descontos de produtos"
                  />

                  <CheckboxInput
                    name="rewardCombinesOrderDiscount"
                    defaultChecked={settings.rewardCombinesOrderDiscount}
                    label="Combinar com descontos do pedido"
                  />

                  <CheckboxInput
                    name="rewardCombinesShipping"
                    defaultChecked={settings.rewardCombinesShipping}
                    label="Combinar com desconto de frete"
                  />
                </div>
              </Field>
            </div>
          </div>
        </section>

        <section className="coupon-card">
          <h2>Regras do programa</h2>

          <p className="coupon-card-description">
            Controla quando uma indicação será considerada válida e quais
            proteções serão aplicadas.
          </p>

          <div className="coupon-grid">
            <Field
              label="Momento de liberar a recompensa"
              explanation="Define em qual etapa do pedido a recompensa será criada."
            >
              <SelectInput
                name="rewardReleaseMoment"
                defaultValue={settings.rewardReleaseMoment}
              >
                <option value="PAID">Após o pagamento</option>
                <option value="FULFILLED">Após o envio</option>
                <option value="WAITING_PERIOD">
                  Após o prazo de espera
                </option>
              </SelectInput>
            </Field>

            <Field
              label="Prazo de espera"
              explanation="Define quantos dias o indicador aguardará antes da liberação da recompensa."
            >
              <NumberInput
                name="rewardWaitingDays"
                defaultValue={settings.rewardWaitingDays}
              />
            </Field>

            <Field
              label="Regra para reembolso"
              explanation="Define o que acontecerá caso o pedido indicado seja cancelado ou reembolsado."
            >
              <SelectInput
                name="refundRule"
                defaultValue={settings.refundRule}
              >
                <option value="CANCEL_REWARD">
                  Cancelar ou invalidar a recompensa
                </option>

                <option value="IGNORE_AFTER_RELEASE">
                  Manter recompensa já liberada
                </option>

                <option value="MANUAL_REVIEW">
                  Enviar para análise manual
                </option>
              </SelectInput>
            </Field>

            <Field
              label="Máximo de recompensas por mês"
              explanation="Define quantas recompensas cada cliente poderá receber no mesmo mês."
            >
              <NumberInput
                name="monthlyRewardLimit"
                defaultValue={settings.monthlyRewardLimit}
              />
            </Field>

            <div className="coupon-field-full">
              <div className="coupon-checkboxes">
                <CheckboxInput
                  name="preventSelfReferral"
                  defaultChecked={settings.preventSelfReferral}
                  label="Impedir que o criador utilize o próprio cupom de indicação"
                />

                <CheckboxInput
                  name="allowMultipleProgramCoupons"
                  defaultChecked={settings.allowMultipleProgramCoupons}
                  label="Permitir que uma pessoa use cupons de indicadores diferentes em compras separadas"
                />

                <CheckboxInput
                  name="excludeGiftCards"
                  defaultChecked={settings.excludeGiftCards}
                  label="Excluir vales-presente do programa"
                />

                <CheckboxInput
                  name="requirePaidOrder"
                  defaultChecked={settings.requirePaidOrder}
                  label="Exigir que o pedido indicado esteja pago"
                />

                <CheckboxInput
                  name="requireAuthenticatedCustomer"
                  defaultChecked={settings.requireAuthenticatedCustomer}
                  label="Exigir que o comprador indicado esteja conectado a uma conta"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="coupon-actions">
          <button
            className="coupon-save-button"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? "Salvando..." : "Salvar configurações"}
          </button>
        </div>
      </Form>
    </s-page>
  );
}