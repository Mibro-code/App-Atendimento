import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";
import {APP_URL} from "./app-url";

export default async () => {
  render(<IndiqueEGanhe />, document.body);
};

function formatDate(value) {
  if (!value) {
    return "Sem validade definida";
  }

  return new Intl.DateTimeFormat("pt-BR").format(
    new Date(value),
  );
}

function rewardStatusLabel(status) {
  const labels = {
    ACTIVE: "Disponível",
    USED: "Utilizada",
    EXPIRED: "Expirada",
    CANCELLED: "Cancelada",
  };

  return labels[status] || status;
}

function IndiqueEGanhe() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [generationError, setGenerationError] =
    useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  async function requestReferralData(method) {
    const token = await shopify.sessionToken.get();

    const response = await fetch(
      `${APP_URL}/api/referral-account`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(
        result.message ||
          "Não foi possível carregar os dados.",
      );
    }

    return result;
  }

  async function loadReferralData() {
    try {
      setError("");

      const result = await requestReferralData("GET");

      setData(result);
    } catch (requestError) {
      console.error(
        "Erro ao carregar programa de indicação:",
        requestError,
      );

      setError(
        "Não foi possível carregar seu programa de indicação.",
      );
    }
  }

  async function generateReferralCoupon() {
    if (isGenerating) return;

    try {
      setIsGenerating(true);
      setGenerationError("");

      await requestReferralData("POST");
      await loadReferralData();
    } catch (requestError) {
      console.error(
        "Erro ao gerar cupom de indicação:",
        requestError,
      );

      setGenerationError(
        requestError?.message ||
          "Não foi possível gerar seu cupom.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  useEffect(() => {
    loadReferralData();
    // O carregamento ocorre uma vez ao abrir a página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <s-page heading="Indique e Ganhe">
        <s-banner tone="critical" heading="Erro">
          {error}
        </s-banner>
      </s-page>
    );
  }

  if (!data) {
    return (
      <s-page heading="Indique e Ganhe">
        <s-section>
          <s-text>Carregando seus cupons...</s-text>
        </s-section>
      </s-page>
    );
  }

  const {
    referralCoupon,
    rewards = [],
    campaignActive = false,
    statistics = {
      totalReferrals: 0,
      availableRewards: 0,
      usedRewards: 0,
    },
  } = data;

  if (!campaignActive) {
    const referralCouponIsValid =
      referralCoupon?.status === "ACTIVE" &&
      (!referralCoupon.endsAt ||
        new Date(referralCoupon.endsAt) >= new Date());

    const coupons = [
      ...(referralCouponIsValid
        ? [
            {
              ...referralCoupon,
              id: "referral-coupon",
              typeLabel: "Cupom de indicação",
            },
          ]
        : []),
      ...rewards.map((reward) => ({
        ...reward,
        typeLabel: "Cupom de recompensa",
      })),
    ];

    return (
      <s-page heading="Cupons">
        <s-section heading="Seus cupons">
          {coupons.length === 0 ? (
            <s-text>
              Você ainda não possui cupons nesta conta.
            </s-text>
          ) : (
            <s-stack gap="base">
              {coupons.map((coupon) => {
                const clipboardId = `coupon-clipboard-${coupon.id}`;

                return (
                  <s-box
                    key={coupon.id}
                    padding="base"
                    border="base"
                    borderRadius="base"
                  >
                    <s-stack gap="base">
                      <s-text tone="subdued">
                        {coupon.typeLabel}
                      </s-text>

                      <s-text emphasis="bold">
                        {coupon.code}
                      </s-text>

                      <s-text>
                        Status: {rewardStatusLabel(coupon.status)}
                      </s-text>

                      <s-text>
                        Válido até: {formatDate(coupon.endsAt)}
                      </s-text>

                      {coupon.status === "ACTIVE" && (
                        <>
                          <s-button
                            command="--copy"
                            commandFor={clipboardId}
                          >
                            Copiar cupom
                          </s-button>

                          <s-clipboard-item
                            id={clipboardId}
                            text={coupon.code}
                          />
                        </>
                      )}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          )}
        </s-section>
      </s-page>
    );
  }
  return (
    <s-page heading="Indique e Ganhe">
      <s-stack gap="base">
        <s-banner heading="Seu programa de indicação">
          Compartilhe seu cupom. Quando uma compra válida
          for confirmada, você receberá uma recompensa.
        </s-banner>

        {!referralCoupon ? (
          <s-section heading="Seu cupom de indicação">
            <s-stack gap="base">
              <s-text>
                Você ainda não possui um cupom de indicação.
              </s-text>

              <s-text>
                Gere seu cupom para compartilhar com seus
                amigos. O desconto seguirá as regras
                definidas pela loja.
              </s-text>

              <s-button
                onClick={generateReferralCoupon}
                disabled={isGenerating}
                loading={isGenerating}
              >
                {isGenerating
                  ? "Gerando cupom..."
                  : "Gerar meu cupom"}
              </s-button>

              {generationError ? (
                <s-banner tone="critical">
                  {generationError}
                </s-banner>
              ) : null}
            </s-stack>
          </s-section>
        ) : (
          <>
            <s-section heading="Seu cupom de indicação">
              <s-stack gap="base">
                <s-text>
                  Compartilhe este código. Quem utilizar
                  recebe o desconto configurado pela loja.
                </s-text>

                <s-box
                  padding="base"
                  border="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack gap="base">
                    <s-text emphasis="bold">
                      {referralCoupon.code}
                    </s-text>

                    <s-button
                      command="--copy"
                      commandFor="referral-code-clipboard"
                    >
                      Copiar cupom
                    </s-button>

                    <s-clipboard-item
                      id="referral-code-clipboard"
                      text={referralCoupon.code}
                    />
                  </s-stack>
                </s-box>

                <s-text>
                  Indicações confirmadas:{" "}
                  {statistics.totalReferrals}
                </s-text>
              </s-stack>
            </s-section>

            <s-section heading="Resumo">
              <s-stack gap="base">
                <s-text>
                  Recompensas disponíveis:{" "}
                  {statistics.availableRewards}
                </s-text>

                <s-text>
                  Recompensas utilizadas:{" "}
                  {statistics.usedRewards}
                </s-text>
              </s-stack>
            </s-section>
          </>
        )}

        <s-section heading="Suas recompensas">
          {rewards.length === 0 ? (
            <s-text>
              Você ainda não possui recompensas.
            </s-text>
          ) : (
            <s-stack gap="base">
              {rewards.map((reward) => {
                const clipboardId = `reward-clipboard-${reward.id}`;

                return (
                  <s-box
                    key={reward.id}
                    padding="base"
                    border="base"
                    borderRadius="base"
                  >
                    <s-stack gap="base">
                      <s-text emphasis="bold">
                        {reward.code}
                      </s-text>

                      <s-text>
                        Status:{" "}
                        {rewardStatusLabel(reward.status)}
                      </s-text>

                      <s-text>
                        Válido até:{" "}
                        {formatDate(reward.endsAt)}
                      </s-text>

                      {reward.status === "ACTIVE" && (
                        <>
                          <s-button
                            command="--copy"
                            commandFor={clipboardId}
                          >
                            Copiar recompensa
                          </s-button>

                          <s-clipboard-item
                            id={clipboardId}
                            text={reward.code}
                          />
                        </>
                      )}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          )}
        </s-section>

        <s-section heading="Como funciona">
          <s-ordered-list>
            <s-list-item>
              Compartilhe seu cupom de indicação.
            </s-list-item>

            <s-list-item>
              Outra pessoa utiliza o código em uma compra.
            </s-list-item>

            <s-list-item>
              Após o pagamento, sua recompensa aparece aqui.
            </s-list-item>
          </s-ordered-list>
        </s-section>
      </s-stack>
    </s-page>
  );
}
