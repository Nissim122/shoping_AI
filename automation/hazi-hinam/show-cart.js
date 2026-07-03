// "תציג לי את הסל" — opens the real logged-in browser straight on the cart
// page, no API calls, no additions. Just a visual look, handed to the user.
//
// Usage: node automation/hazi-hinam/show-cart.js

const { ensureSession, openCartInBrowser } = require('./run-list');

(async () => {
  await ensureSession();
  await openCartInBrowser();
})();
