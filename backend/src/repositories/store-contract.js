const STORE_METHODS = [
  "ensureUser", "getUser", "getUserByIdentity", "updateUserProfile", "listUsers",
  "createSession", "getSession", "getSessionByTokenHash", "touchSession", "revokeSession", "revokeSessionByTokenHash", "revokeAllSessions",
  "createCreditPackage", "getCreditPackage", "listCreditPackages", "createCreditHold", "getCreditHold",
  "settleCreditHold", "releaseCreditHold", "addCredits", "charge", "listCreditTransactions",
  "createTask", "createTaskWithCreditHold", "getTask", "listTasks", "claimTask", "renewTaskLease", "releaseTaskLease", "reclaimExpiredTasks", "updateTask",
  "createAsset", "createGeneratedAsset", "getAsset", "getGeneratedAsset", "findOwnedAsset", "findOwnedImageAsset", "listAssets", "listGeneratedAssets", "deleteAsset",
  "createReferenceAsset", "getReferenceAsset", "listReferenceAssets", "deleteReferenceAsset",
  "createCatalogVersion", "getCatalogVersion", "getCatalogVersionState", "getActiveCatalogVersion", "activateCatalogVersion",
  "importCatalogVersion",
  "syncTemplates", "listTemplates", "getTemplate",
  "createOrder", "getOrder", "getOrderByIdempotencyKey", "listOrders", "listAllOrders",
  "fulfillOrder", "fulfillMockOrder", "cancelOrder", "acceptRefund", "completeRefund", "failRefund", "refundOrder",
  "claimStaleOrders", "releaseOrderReconciliationLease", "recordPaymentFulfillment", "fulfillPayment",
  "getPaymentFulfillment", "recordPaymentEvent", "listPaymentAudit",
  "recordAdminAudit", "listAdminAudit", "close",
];

function assertStoreContract(store) {
  const missing = STORE_METHODS.filter((method) => typeof store?.[method] !== "function");
  if (missing.length) throw new TypeError(`Store contract is missing: ${missing.join(", ")}`);
  return store;
}

module.exports = {
  STORE_METHODS,
  assertStoreContract,
};
