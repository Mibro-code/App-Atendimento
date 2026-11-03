import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import {createRewardCouponForCustomer} from "../services/reward-coupon.server";
import {authenticate} from "../shopify.server";

const DISCOUNT_TYPES = new Set(["PERCENTAGE", "FIXED_AMOUNT"]);
const CUSTOMER_ELIGIBILITIES = new Set([
  "OWNER_ONLY",
  "ALL_CUSTOMERS",
]);

function parseNumericField(
  formData,
  name,
  label,
  {integer = false, max},
) {
  const rawValue = String(formData.get(name) || "")
    .trim()
    .replace(",", ".");
  const value = Number(rawValue);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} precisa ser maior que zero.`);
  }

  if (integer && !Number.isInteger(value)) {
    throw new Error(`${label} precisa ser um n\u00famero inteiro.`);
  }

  if (max && value > max) {
    throw new Error(`${label} n\u00e3o pode ser maior que ${max}.`);
  }

  return value;
}

function parseCouponOptions(formData) {
  const discountType = String(
    formData.get("discountType") || "",
  ).toUpperCase();

  if (!DISCOUNT_TYPES.has(discountType)) {
    throw new Error("Selecione um tipo de desconto v\u00e1lido.");
  }

  const discountValue = parseNumericField(
    formData,
    "discountValue",
    "O valor do desconto",
    {max: discountType === "PERCENTAGE" ? 100 : 1000000},
  );
  const durationDays = parseNumericField(
    formData,
    "durationDays",
    "A dura\u00e7\u00e3o do cupom",
    {integer: true, max: 3650},
  );
  const usageLimit = parseNumericField(
    formData,
    "usageLimit",
    "A quantidade total de usos",
    {integer: true, max: 100000},
  );
  const customerEligibility = String(
    formData.get("customerEligibility") || "",
  ).toUpperCase();

  if (!CUSTOMER_ELIGIBILITIES.has(customerEligibility)) {
    throw new Error("Selecione quem pode utilizar o cupom.");
  }

  const couponName = String(formData.get("couponName") || "").trim();

  if (couponName.length > 40) {
    throw new Error("O nome do cupom pode ter no m\u00e1ximo 40 caracteres.");
  }

  if (couponName && !/[\p{L}\p{N}]/u.test(couponName)) {
    throw new Error("O nome do cupom precisa conter letras ou n\u00fameros.");
  }

  return {
    discountType,
    discountValue,
    durationDays,
    usageLimit,
    customerEligibility,
    couponName,
    appliesOncePerCustomer:
      formData.get("appliesOncePerCustomer") === "true",
  };
}

export async function loader({request}) {
  const {admin} = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query GetCustomers {
        customers(
          first: 50
          sortKey: UPDATED_AT
          reverse: true
        ) {
          nodes {
            id
            displayName
            firstName
            lastName
            email
          }
        }
      }
    `,
  );

  const responseJson = await response.json();

  const customers =
    responseJson.data?.customers?.nodes ?? [];

  return {
    customers,
  };
}

export async function action({request}) {
  const {admin, session} =
    await authenticate.admin(request);

  const formData = await request.formData();

  const customerId = String(
    formData.get("customerId") || "",
  ).trim();

  if (!customerId) {
    return {
      success: false,
      message: "Selecione um cliente.",
    };
  }

  let couponOptions;

  try {
    couponOptions = parseCouponOptions(formData);
  } catch (error) {
    return {
      success: false,
      message: error?.message || "Revise os detalhes do cupom.",
    };
  }

  const customerResponse = await admin.graphql(
    `#graphql
      query GetSelectedCustomer($id: ID!) {
        customer(id: $id) {
          id
          displayName
          firstName
          lastName
          email
        }
      }
    `,
    {
      variables: {
        id: customerId,
      },
    },
  );

  const customerJson = await customerResponse.json();

  const customer = customerJson.data?.customer;

  if (!customer) {
    return {
      success: false,
      message: "O cliente selecionado não foi encontrado.",
    };
  }

  try {
    const coupon = await createRewardCouponForCustomer({
      admin,
      shop: session.shop,
      customer,
      couponOptions,
    });

    return {
      success: true,
      message: `Cupom ${coupon.code} criado para o cliente.`,
      code: coupon.code,
    };
  } catch (error) {
    console.error(
      "Erro ao criar cupom de recompensa pelo administrador:",
      error,
    );

    return {
      success: false,
      message:
        error?.message ||
        "Não foi possível criar o cupom de recompensa.",
    };
  }
}
export default function ReferralCouponsPage() {
  const {customers} = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();

  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Cupons de recompensa">
      <style>{`
        .referral-container {
          max-width: 720px;
        }

        .referral-card {
          background: #ffffff;
          border: 1px solid #e1e3e5;
          border-radius: 12px;
          padding: 22px;
        }

        .referral-card h2 {
          margin-top: 0;
        }

        .referral-field {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-bottom: 18px;
        }

        .referral-field label {
          font-weight: 600;
        }

        .referral-field p {
          margin: 0;
          color: #616161;
          font-size: 13px;
        }

        .referral-input {
          width: 100%;
          box-sizing: border-box;
          min-height: 42px;
          padding: 9px 10px;
          border: 1px solid #8a8a8a;
          border-radius: 8px;
          background: #ffffff;
          font: inherit;
        }
        .referral-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          column-gap: 16px;
        }

        .referral-check {
          display: flex;
          align-items: center;
          gap: 9px;
          cursor: pointer;
        }

        .referral-check input {
          width: 18px;
          height: 18px;
          margin: 0;
        }

        @media (max-width: 640px) {
          .referral-grid {
            grid-template-columns: 1fr;
          }
        }


        .referral-button {
          min-height: 40px;
          padding: 10px 18px;
          color: #ffffff;
          background: #303030;
          border: 0;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
        }

        .referral-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .referral-message {
          margin-bottom: 18px;
          padding: 12px;
          border-radius: 8px;
          font-weight: 600;
        }

        .referral-success {
          color: #174d2b;
          background: #e8f5ec;
          border: 1px solid #a7d7b5;
        }

        .referral-error {
          color: #8e1f0b;
          background: #fff0ed;
          border: 1px solid #f0b4a8;
        }

        .referral-code {
          margin-top: 18px;
          padding: 14px;
          background: #f6f6f7;
          border-radius: 8px;
          font-family: monospace;
          font-size: 18px;
          font-weight: 700;
        }

        .referral-empty {
          padding: 14px;
          color: #616161;
          background: #f6f6f7;
          border-radius: 8px;
        }
      `}</style>

      <div className="referral-container">
        <div className="referral-card">
          <h2>Gerar recompensa para cliente</h2>

          <p>
            Selecione uma conta real cadastrada na loja para
            criar um cupom de recompensa.
          </p>

          {actionData?.message && (
            <div
              className={`referral-message ${
                actionData.success
                  ? "referral-success"
                  : "referral-error"
              }`}
            >
              {actionData.message}
            </div>
          )}

          {customers.length === 0 ? (
            <div className="referral-empty">
              Nenhum cliente foi encontrado na loja. Crie
              uma conta de cliente para realizar o teste.
            </div>
          ) : (
            <Form method="post">
              <div className="referral-field">
                <label htmlFor="customerId">Cliente</label>

                <p>
                  O cupom ficará disponível nas recompensas
                  da conta selecionada.
                </p>

                <select
                  className="referral-input"
                  id="customerId"
                  name="customerId"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Selecione um cliente
                  </option>

                  {customers.map((customer) => {
                    const name =
                      customer.displayName ||
                      [
                        customer.firstName,
                        customer.lastName,
                      ]
                        .filter(Boolean)
                        .join(" ") ||
                      "Cliente sem nome";

                    return (
                      <option
                        key={customer.id}
                        value={customer.id}
                      >
                        {name}
                        {customer.email
                          ? ` — ${customer.email}`
                          : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="referral-field">
                <label htmlFor="couponName">
                  Nome do cupom (opcional)
                </label>
                <input
                  className="referral-input"
                  id="couponName"
                  name="couponName"
                  type="text"
                  maxLength="40"
                  placeholder="Ex.: Presente VIP"
                />
                <p>
                  {"O c\u00f3digo manter\u00e1 um identificador aleat\u00f3rio. "}
                  Exemplo: RECOMPENSA-PRESENTEVIP-A1B2C3D4.
                  Se ficar vazio, usaremos o nome do cliente.
                </p>
              </div>

              <div className="referral-grid">
                <div className="referral-field">
                  <label htmlFor="discountType">
                    Tipo de desconto
                  </label>
                  <select
                    className="referral-input"
                    id="discountType"
                    name="discountType"
                    defaultValue="PERCENTAGE"
                    required
                  >
                    <option value="PERCENTAGE">
                      Percentual (%)
                    </option>
                    <option value="FIXED_AMOUNT">
                      Valor fixo
                    </option>
                  </select>
                </div>

                <div className="referral-field">
                  <label htmlFor="discountValue">
                    Valor do desconto
                  </label>
                  <input
                    className="referral-input"
                    id="discountValue"
                    name="discountValue"
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    defaultValue="10"
                    required
                  />
                  <p>
                    Para percentual, informe de 0,01 a 100.
                    Para valor fixo, use a moeda da loja.
                  </p>
                </div>

                <div className="referral-field">
                  <label htmlFor="durationDays">
                    {"Dura\u00e7\u00e3o do cupom em dias"}
                  </label>
                  <input
                    className="referral-input"
                    id="durationDays"
                    name="durationDays"
                    type="number"
                    min="1"
                    max="3650"
                    step="1"
                    defaultValue="30"
                    required
                  />
                </div>

                <div className="referral-field">
                  <label htmlFor="usageLimit">
                    Quantidade total de usos
                  </label>
                  <input
                    className="referral-input"
                    id="usageLimit"
                    name="usageLimit"
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                    defaultValue="1"
                    required
                  />
                </div>
              </div>

              <div className="referral-field">
                <label htmlFor="customerEligibility">
                  Quem pode usar
                </label>
                <select
                  className="referral-input"
                  id="customerEligibility"
                  name="customerEligibility"
                  defaultValue="OWNER_ONLY"
                  required
                >
                  <option value="OWNER_ONLY">
                    Somente o cliente selecionado
                  </option>
                  <option value="ALL_CUSTOMERS">
                    Todos os clientes
                  </option>
                </select>
                <p>
                  {"O cupom continuar\u00e1 aparecendo como recompensa"}
                  do cliente selecionado.
                </p>
              </div>

              <div className="referral-field">
                <label
                  className="referral-check"
                  htmlFor="appliesOncePerCustomer"
                >
                  <input
                    id="appliesOncePerCustomer"
                    name="appliesOncePerCustomer"
                    type="checkbox"
                    value="true"
                    defaultChecked
                  />
                  <span>Permitir somente um uso por cliente</span>
                </label>
                <p>
                  Desmarque se o mesmo cliente puder utilizar o
                  cupom mais de uma vez, respeitando o limite total.
                </p>
              </div>


              <button
                className="referral-button"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Criando cupom..."
                  : "Criar cupom de recompensa"}
              </button>
            </Form>
          )}

          {actionData?.code && (
            <div className="referral-code">
              {actionData.code}
            </div>
          )}
        </div>
      </div>
    </s-page>
  );
}
