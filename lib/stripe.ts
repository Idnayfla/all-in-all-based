import Stripe from 'stripe';

// Use a placeholder key when missing so module load doesn't throw.
// Routes guard with `if (!process.env.STRIPE_SECRET_KEY)` before using stripe.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'placeholder_not_configured', {
  apiVersion: '2026-04-22.dahlia',
});
