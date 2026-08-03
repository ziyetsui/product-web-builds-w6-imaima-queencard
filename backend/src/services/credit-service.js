function createCreditService(options = {}) {
  const store = options.store;

  async function hold(input) {
    if (typeof store.createCreditHold !== "function") throw new Error("Store does not support durable credit holds");
    return store.createCreditHold(input);
  }

  async function settle(holdId, actualCredits, input = {}) {
    if (typeof store.settleCreditHold !== "function") throw new Error("Store does not support credit settlement");
    return store.settleCreditHold(holdId, actualCredits, input);
  }

  async function release(holdId) {
    if (typeof store.releaseCreditHold !== "function") throw new Error("Store does not support credit release");
    return store.releaseCreditHold(holdId);
  }

  async function get(holdId) {
    return store.getCreditHold ? store.getCreditHold(holdId) : null;
  }

  return { hold, settle, release, get };
}

module.exports = {
  createCreditService,
};
