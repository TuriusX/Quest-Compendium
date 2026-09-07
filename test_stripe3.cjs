require('dotenv').config();
const Stripe = require('stripe');
async function checkStripe() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
  const customers = await stripe.customers.list({ email: 'noahfminton@gmail.com', limit: 1 });
  if (customers.data.length > 0) {
    const subs = await stripe.subscriptions.list({ customer: customers.data[0].id, status: 'active', limit: 1 });
    console.log('Active subscriptions found:', subs.data.length);
  }
}
checkStripe().catch(console.error);
