require('dotenv').config();
const Stripe = require('stripe');
async function checkStripe() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
  const customers = await stripe.customers.list({ limit: 10 });
  console.log('Total customers:', customers.data.length);
  customers.data.forEach(c => {
    console.log(`- ${c.email} (ID: ${c.id})`);
  });
}
checkStripe().catch(console.error);
