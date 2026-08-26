import { useState } from "react";
import type {
  EIP1193Provider,
  RecoverTypedDataAddressParameters,
  SignTypedDataParameters,
} from "viem";
import { approveRelease, getApprovalRequest } from "../../lib/api.js";

type InjectedWindow = Window & { ethereum?: EIP1193Provider };

export function ApprovalAction({
  owner,
  releaseId,
  version,
}: {
  owner: string;
  releaseId: string;
  version: number;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function approve() {
    const provider = (window as InjectedWindow).ethereum;
    if (!provider) {
      setMessage(
        "Open this page in a browser with MetaMask or another EVM wallet.",
      );
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const {
        createWalletClient,
        custom,
        getAddress,
        recoverTypedDataAddress,
      } = await import("viem");
      const wallet = createWalletClient({ transport: custom(provider) });
      const [account] = await wallet.requestAddresses();
      if (!account || getAddress(account) !== getAddress(owner)) {
        throw new Error(`Connect the owner wallet ${owner}.`);
      }
      const request = await getApprovalRequest(releaseId);
      const signature = await wallet.signTypedData({
        ...(request.typedData as SignTypedDataParameters),
        account,
      });
      const recovered = getAddress(
        await recoverTypedDataAddress({
          ...(request.typedData as RecoverTypedDataAddressParameters),
          signature,
        }),
      );
      if (recovered !== getAddress(owner)) {
        throw new Error(
          `The wallet signed with ${recovered}. Switch MetaMask to the owner ${owner}.`,
        );
      }
      await approveRelease(releaseId, version, signature);
      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The wallet did not approve this release.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="approval-action" aria-labelledby="approval-title">
      <div>
        <span className="section-kicker">Human authority required</span>
        <h2 id="approval-title">
          The agents finished testing. You decide whether deployment may begin.
        </h2>
        <p>
          Your signature binds this request, source, artifact, tests, and
          Arbitrum Sepolia. Signing spends no gas.
        </p>
      </div>
      <div className="approval-controls">
        <code>{owner}</code>
        <button
          className="button"
          disabled={pending}
          onClick={() => void approve()}
          type="button"
        >
          {pending ? "Waiting for wallet…" : "Review and sign exact release"}
        </button>
        {message && (
          <p className="form-message error" role="alert">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
