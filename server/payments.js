// Payments: Stripe Checkout when STRIPE_SECRET_KEY is set; otherwise an explicitly
// labelled DEMO card flow (no money moves) unless PAYMENTS_DEMO=0. Cash/terminal on pickup always works.
let stripe = null;
export async function initPayments() {
  if (process.env.STRIPE_SECRET_KEY) {
    const { default: Stripe } = await import('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return mode();
}

export const mode = () => (stripe ? 'stripe' : process.env.PAYMENTS_DEMO === '0' ? 'off' : 'demo');

export async function createCheckout(order, brand, baseUrl) {
  if (mode() === 'stripe') {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: { currency: brand.currency.toLowerCase(), unit_amount: order.total_cents,
          product_data: { name: `${brand.name} užsakymas ${order.code}` } },
      }],
      metadata: { order_id: String(order.id) },
      success_url: `${baseUrl}/order/${order.public_token}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout?cancelled=1`,
    });
    return { type: 'stripe', url: session.url, sessionId: session.id };
  }
  if (mode() === 'demo') return { type: 'demo' };
  return { type: 'off' };
}

/** Verify a Stripe session belongs to this order and is paid. */
export async function verifyStripe(order, sessionId) {
  if (mode() !== 'stripe' || !sessionId || sessionId !== order.stripe_session_id) return false;
  const s = await stripe.checkout.sessions.retrieve(sessionId);
  return s.payment_status === 'paid' && s.metadata?.order_id === String(order.id) && s.amount_total === order.total_cents;
}

export function webhookEvent(rawBody, signature) {
  if (mode() !== 'stripe' || !process.env.STRIPE_WEBHOOK_SECRET) return null;
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}
