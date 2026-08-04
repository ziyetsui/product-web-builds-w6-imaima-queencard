function createMockPaymentProvider() {
  return {
    name: "mock",
    mode: "mock",
    async createPayment() {
      return {
        paymentStatus: "mock_pending",
        paymentMode: "mock",
        paymentParams: null,
      };
    },
  };
}

module.exports = { createMockPaymentProvider };
