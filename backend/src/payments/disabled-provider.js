function createDisabledPaymentProvider() {
  return {
    name: "disabled",
    mode: "manual",
    async createPayment() {
      return {
        paymentStatus: "manual_pending",
        paymentMode: "manual",
        paymentParams: null,
      };
    },
    async refund() {
      const error = new Error("Payment provider is disabled");
      error.status = 503;
      error.code = "PAYMENT_PROVIDER_DISABLED";
      throw error;
    },
  };
}

module.exports = { createDisabledPaymentProvider };
