/** @jsxImportSource preact */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default function extension() {
  render(<ThankYouReviewLink />, document.body);
}

function getBuyerEmailUnavailableMessage() {
  if (!shopify.buyerIdentity) {
    return (
      "Customer email is unavailable. In Partner Dashboard, open this app -> " +
      "API access requests -> Protected customer data access, enable Protected " +
      "customer data and the Email field, then reinstall the app on your store."
    );
  }

  return "Customer email is unavailable on this checkout.";
}

function ThankYouReviewLink() {
  const [reviewUrl, setReviewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const heading = shopify.settings?.value?.heading || "Thanks for your order";
  const description =
    shopify.settings?.value?.description ||
    "We would love to hear about your experience.";
  const buttonLabel = shopify.settings?.value?.button_label || "Leave us a review";
  const workerUrl = shopify.settings?.value?.worker_url?.replace(/\/$/, "") || "";
  const workerApiKey = shopify.settings?.value?.worker_api_key || "";

  const email = shopify.buyerIdentity?.email?.value;
  const customer = shopify.buyerIdentity?.customer?.value;
  const firstName = customer?.firstName || "";
  const lastName = customer?.lastName || "";
  const orderId = shopify.orderConfirmation?.value?.number
    ? String(shopify.orderConfirmation.value.number)
    : "";

  useEffect(() => {
    createInvitationLink();
  }, [email, orderId, workerUrl, workerApiKey]);

  async function createInvitationLink() {
    setLoading(true);
    setError("");

    try {
      if (!workerUrl) {
        throw new Error("Worker URL is not configured in block settings.");
      }

      if (!email) {
        throw new Error(getBuyerEmailUnavailableMessage());
      }

      const headers = {
        "Content-Type": "application/json",
      };

      if (workerApiKey) {
        headers["X-Api-Key"] = workerApiKey;
      }

      const response = await fetch(workerUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          referenceId: orderId || undefined,
          orderId: orderId || undefined,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            "Unauthorized: set the Worker API key in this block's settings to match the WORKER_API_KEY secret on your Cloudflare Worker."
          );
        }
        throw new Error(json.error || "Unable to create review link.");
      }

      if (!json.url) {
        throw new Error("Worker response did not include a review URL.");
      }

      setReviewUrl(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load review link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <s-box border="base" padding="base" borderRadius="base">
      <s-stack gap="base">
        <s-heading>{heading}</s-heading>
        <s-text>{description}</s-text>

        {loading ? <s-spinner accessibilityLabel="Preparing review link" /> : null}

        {error ? (
          <s-stack gap="small">
            <s-text tone="critical">{error}</s-text>
            <s-button variant="secondary" onClick={createInvitationLink}>
              Try again
            </s-button>
          </s-stack>
        ) : null}

        {!loading && !error && reviewUrl ? (
          <s-button variant="primary" href={reviewUrl} target="_blank">
            {buttonLabel}
          </s-button>
        ) : null}
      </s-stack>
    </s-box>
  );
}
