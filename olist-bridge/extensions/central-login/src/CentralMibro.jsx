import '@shopify/ui-extensions/preact';
import { render } from 'preact';

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  return (
    <s-page title="Central do Cliente">
      <s-section>
        <s-stack gap="base">
          <s-heading>Central do Cliente</s-heading>

          <s-text>
            Acesse seus pedidos, suporte, garantia e informações da sua conta em um só lugar.
          </s-text>

          <s-banner tone="info">
            Por segurança, dados sensíveis como senha, pagamentos e informações completas da conta são gerenciados diretamente pela área oficial da Shopify.
          </s-banner>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-heading>Acesso rápido</s-heading>

          <s-button href="/account">
            Meus pedidos e dados da conta
          </s-button>

          <s-button href="/pages/garantia">
            Garantia 
          </s-button>

          <s-button href="/pages/contato">
            Suporte 
          </s-button>

          <s-button href="/pages/aplicativo-fit">
            Aplicativo Fit
          </s-button>
        </s-stack>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-heading>Após a compra</s-heading>

          <s-text>
            Encontre guias de instalação, informações de garantia e canais de suporte para seus produtos.
          </s-text>

          <s-button href="/pages/guias-de-instalacao">
            Guias de instalação
          </s-button>

          <s-button href="/pages/politicas">
            Políticas da loja
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}