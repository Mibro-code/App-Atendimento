import "@shopify/ui-extensions/preact";
import {render} from "preact";

export default async () => {
  render(<ProfileBlock />, document.body);
};

function ProfileBlock() {
  return (
    <s-section heading="Cupons">
      <s-stack gap="base">
        <s-text>
          Consulte os cupons disponíveis na sua conta.
        </s-text>

        <s-button
          variant="primary"
          href="extension://indique-e-ganhe"
        >
          Ver cupons
        </s-button>
      </s-stack>
    </s-section>
  );
}
