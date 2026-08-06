function paymentError(message, status = 409, code = "PAYMENT_RECONCILIATION_FAILED") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function value(env, keys) {
  for (const key of keys) {
    const candidate = String(env?.[key] || "").trim();
    if (candidate) return candidate;
  }
  return "";
}

function nowDate(clock) {
  const value = typeof clock === "function" ? clock() : clock;
  return value instanceof Date ? value : new Date(value || Date.now());
}

function providerStatus(payload) {
  return String(payload?.refund_status || payload?.status || "").trim().toUpperCase();
}

function createPaymentReconciliationService(options = {}) {
  const store = options.store;
  const provider = options.paymentProvider;
  const env = options.env || process.env;
  const clock = options.clock || (() => new Date());
  const appId = value(env, ["WECHAT_MINIAPP_APP_ID", "WECHAT_APP_ID"]);
  const merchantId = value(env, ["WECHAT_PAY_MERCHANT_ID", "WECHAT_MCHID"]);

  if (!store) throw new TypeError("Payment reconciliation requires a store");

  function assertProviderMethod(method) {
    if (provider?.mode !== "wechat" || typeof provider?.[method] !== "function") {
      throw paymentError(`WeChat payment provider does not support ${method}`, 503, "PAYMENT_PROVIDER_NOT_CONFIGURED");
    }
  }

  function assertPaymentTransaction(order, transaction) {
    const transactionAppId = String(transaction?.appid || "").trim();
    const transactionMerchantId = String(transaction?.mchid || "").trim();
    const transactionOrderId = String(transaction?.out_trade_no || "").trim();
    const transactionId = String(transaction?.transaction_id || "").trim();
    const total = Number(transaction?.amount?.total);
    const currency = String(transaction?.amount?.currency || "").trim().toUpperCase();
    const orderCurrency = String(order.currency || "").trim().toUpperCase();
    if (!transactionAppId || transactionAppId !== appId
      || !transactionMerchantId || transactionMerchantId !== merchantId) {
      throw paymentError("WeChat payment identity does not match this application", 400, "PAYMENT_RECONCILIATION_IDENTITY_MISMATCH");
    }
    if (!transactionOrderId || transactionOrderId !== order.id || !transactionId) {
      throw paymentError("WeChat payment order identity does not match the local order", 400, "PAYMENT_RECONCILIATION_ORDER_MISMATCH");
    }
    if (!Number.isSafeInteger(total) || total !== Number(order.amountCents)) {
      throw paymentError("WeChat payment amount does not match the order", 400, "PAYMENT_AMOUNT_MISMATCH");
    }
    if (!currency || !orderCurrency || currency !== orderCurrency) {
      throw paymentError("WeChat payment currency does not match the order", 400, "PAYMENT_CURRENCY_MISMATCH");
    }
    const tradeType = String(transaction?.trade_type || "").trim().toUpperCase();
    if (tradeType && tradeType !== "JSAPI") {
      throw paymentError("WeChat payment trade type is not supported", 400, "PAYMENT_TRADE_TYPE_MISMATCH");
    }
    return { transactionId, total, currency };
  }

  async function audit(order, input) {
    if (typeof store.recordPaymentEvent !== "function") return null;
    return store.recordPaymentEvent({
      orderId: order.id,
      userId: order.userId,
      type: input.type,
      actorId: input.actorId || "wechat-pay",
      message: input.message || "",
      metadata: input.metadata || {},
    });
  }

  async function fulfillFromTransaction(order, transaction, input = {}) {
    const identity = assertPaymentTransaction(order, transaction);
    const fulfillmentKey = `wechat:${identity.transactionId}`;
    const existing = typeof store.getPaymentFulfillment === "function"
      ? await store.getPaymentFulfillment(fulfillmentKey)
      : null;
    const fulfillment = await store.fulfillPayment({
      fulfillmentKey,
      orderId: order.id,
      provider: "wechat",
      eventId: identity.transactionId,
      eventType: "TRANSACTION.SUCCESS",
      providerOrderId: order.id,
      providerTransactionId: identity.transactionId,
      status: "FULFILLED",
      paymentVerified: true,
      paidAt: transaction.success_time || undefined,
      metadata: {
        paymentVerified: true,
        tradeState: transaction.trade_state,
        appid: transaction.appid,
        mchid: transaction.mchid,
        source: input.source || "reconcile",
      },
    });
    const updatedOrder = await store.getOrder(order.id);
    if (!existing) {
      if (input.source !== "notify") {
        await audit(updatedOrder || order, {
          type: "reconcile",
          actorId: input.actorId || "wechat-pay",
          message: "WeChat payment transaction reconciled",
          metadata: { source: input.source || "reconcile", transactionId: identity.transactionId, amountCents: identity.total },
        });
      }
      await audit(updatedOrder || order, {
        type: "pay",
        actorId: input.actorId || "wechat-pay",
        message: "WeChat payment completed",
        metadata: { transactionId: identity.transactionId, amountCents: identity.total },
      });
      await audit(updatedOrder || order, {
        type: "fulfill",
        actorId: input.actorId || "wechat-pay",
        message: "Credits granted",
        metadata: { credits: updatedOrder?.creditsGranted || order.credits },
      });
    }
    return {
      order: updatedOrder || order,
      fulfillment,
      reconciled: true,
      idempotent: Boolean(existing),
      transaction,
    };
  }

  async function reconcileOrder(orderId, input = {}) {
    const order = await store.getOrder(orderId);
    if (!order) return null;
    if (order.refundStatus && ["accepted", "processing"].includes(order.refundStatus)) {
      return reconcileRefund(order.id, input);
    }
    assertProviderMethod("queryOrder");
    const transaction = await provider.queryOrder({
      order,
      orderId: order.id,
      outTradeNo: order.id,
    });
    if (String(transaction?.trade_state || "").toUpperCase() !== "SUCCESS") {
      await audit(order, {
        type: "reconcile",
        actorId: input.actorId || "wechat-pay",
        message: "WeChat payment transaction is not successful",
        metadata: { source: input.source || "reconcile", tradeState: transaction?.trade_state || "UNKNOWN" },
      });
      return { order: await store.getOrder(order.id), reconciled: false, transaction };
    }
    return fulfillFromTransaction(order, transaction, input);
  }

  async function saveAcceptedRefund(order, response, input = {}) {
    const status = providerStatus(response) || "PROCESSING";
    const outRefundNo = `refund_${order.id}`;
    const responseOutRefundNo = String(response?.out_refund_no || response?.outRefundNo || "").trim();
    if ((input.requireOutRefundNo || responseOutRefundNo) && responseOutRefundNo !== outRefundNo) {
      throw paymentError("WeChat refund number does not match the local order", 400, "PAYMENT_REFUND_IDENTITY_MISMATCH");
    }
    if (response?.mchid != null && String(response.mchid).trim() !== merchantId) {
      throw paymentError("WeChat refund merchant does not match this application", 400, "PAYMENT_REFUND_IDENTITY_MISMATCH");
    }
    const requestedRefundAmount = input.refundAmountCents == null ? Number(order.amountCents) : Number(input.refundAmountCents);
    const refundAmountCents = Number(response?.amount?.refund);
    if (!Number.isSafeInteger(requestedRefundAmount) || requestedRefundAmount !== Number(order.amountCents)
      || !Number.isSafeInteger(refundAmountCents) || refundAmountCents !== Number(order.amountCents)) {
      throw paymentError("WeChat refund amount must equal the order total", 400, "PAYMENT_REFUND_AMOUNT_MISMATCH");
    }
    if (response?.amount?.total != null && Number(response.amount.total) !== Number(order.amountCents)) {
      throw paymentError("WeChat refund total does not match the order", 400, "PAYMENT_REFUND_AMOUNT_MISMATCH");
    }
    const responseCurrency = String(response?.amount?.currency || "").trim().toUpperCase();
    const orderCurrency = String(order.currency || "").trim().toUpperCase();
    if ((input.requireCurrency && (!responseCurrency || !orderCurrency || responseCurrency !== orderCurrency))
      || (responseCurrency && (!orderCurrency || responseCurrency !== orderCurrency))) {
      throw paymentError("WeChat refund currency does not match the order", 400, "PAYMENT_REFUND_CURRENCY_MISMATCH");
    }
    if (response?.out_trade_no && String(response.out_trade_no) !== order.id) {
      throw paymentError("WeChat refund order identity does not match the local order", 400, "PAYMENT_REFUND_ORDER_MISMATCH");
    }
    const refundId = String(response?.refund_id || response?.refundId || input.refundId || "").trim();
    if (!["PROCESSING", "SUCCESS", "CLOSED", "ABNORMAL"].includes(status)) {
      throw paymentError("WeChat refund status is invalid", 400, "PAYMENT_REFUND_STATUS_INVALID");
    }
    if (["CLOSED", "ABNORMAL"].includes(status)) {
      const failed = await store.failRefund(order.id, {
        refundId,
        refundAmountCents,
        error: status,
        metadata: { providerStatus: status, response, outRefundNo },
      });
      await audit(failed?.order || order, {
        type: "refund_failed",
        actorId: input.actorId || "wechat-pay",
        message: "WeChat refund failed",
        metadata: { refundId, providerStatus: status },
      });
      return { order: failed?.order || order, accepted: false, completed: false, refundStatus: "failed", response };
    }
    const accepted = await store.acceptRefund(order.id, {
      refundId,
      refundAmountCents,
      refundStatus: status === "SUCCESS" ? "processing" : "accepted",
      metadata: { providerStatus: status, response, outRefundNo, id: refundId },
    });
    if (accepted?.accepted) {
      await audit(accepted.order, {
        type: "refund_accepted",
        actorId: input.actorId || "wechat-pay",
        message: "WeChat refund accepted by provider",
        metadata: { refundId, refundAmountCents, providerStatus: status },
      });
    }
    if (status !== "SUCCESS") {
      return { order: accepted.order, accepted: Boolean(accepted.accepted), completed: false, refundStatus: accepted.order.refundStatus, response };
    }
    const completed = await store.completeRefund(order.id, { verified: true, refundId, refundAmountCents });
    if (completed?.completed) {
      await audit(completed.order, {
        type: "refund_completed",
        actorId: input.actorId || "wechat-pay",
        message: "WeChat refund completed",
        metadata: { refundId, revokedCredits: completed.revokedCredits },
      });
    }
    return { order: completed?.order || accepted.order, accepted: true, completed: Boolean(completed?.completed), refundStatus: "succeeded", response, revokedCredits: completed?.revokedCredits || 0 };
  }

  async function requestRefund(orderId, input = {}) {
    const order = await store.getOrder(orderId);
    if (!order) return null;
    if (order.refundedAt || order.refundStatus === "succeeded") return { order, accepted: false, completed: false, refundStatus: "succeeded" };
    const refundAmountCents = input.refundAmountCents == null ? Number(order.amountCents) : Number(input.refundAmountCents);
    if (!Number.isSafeInteger(refundAmountCents) || refundAmountCents !== Number(order.amountCents)) {
      throw paymentError("WeChat refund amount must equal the order total", 400, "PAYMENT_REFUND_AMOUNT_MISMATCH");
    }
    if (["accepted", "processing"].includes(order.refundStatus)) {
      if (typeof provider?.queryRefund !== "function") {
        return { order, accepted: false, completed: false, refundStatus: order.refundStatus };
      }
      return reconcileRefund(orderId, input);
    }
    assertProviderMethod("refund");
    const response = await provider.refund({
      order,
      providerTransactionId: order.externalPaymentId,
      outRefundNo: `refund_${order.id}`,
      refundAmountCents,
      reason: input.reason,
    });
    return saveAcceptedRefund(order, response, {
      ...input,
      refundAmountCents,
      requireOutRefundNo: true,
      requireCurrency: true,
    });
  }

  async function reconcileRefund(orderId, input = {}) {
    const order = await store.getOrder(orderId);
    if (!order) return null;
    if (order.refundStatus === "succeeded" || order.refundedAt) return { order, accepted: false, completed: false, refundStatus: "succeeded" };
    assertProviderMethod("queryRefund");
    const response = await provider.queryRefund({
      order,
      orderId: order.id,
      outRefundNo: `refund_${order.id}`,
    });
    return saveAcceptedRefund(order, response, { ...input, requireOutRefundNo: true, requireCurrency: true });
  }

  async function handleRefundNotification(transaction, input = {}) {
    const orderId = String(transaction?.out_trade_no || "").trim();
    if (!orderId) throw paymentError("WeChat refund notification is missing order identity", 400, "PAYMENT_REFUND_NOTIFICATION_INVALID");
    const order = await store.getOrder(orderId);
    if (!order) throw paymentError("WeChat refund order not found", 404, "PAYMENT_ORDER_NOT_FOUND");
    return saveAcceptedRefund(order, transaction, { ...input, requireOutRefundNo: true });
  }

  return {
    reconcileOrder,
    requestRefund,
    reconcileRefund,
    handleRefundNotification,
    fulfillFromTransaction,
  };
}

function createPaymentReconciliationWorker(options = {}) {
  const store = options.store;
  const service = options.service || createPaymentReconciliationService(options);
  const workerId = options.workerId || `payment-reconciliation-${process.pid}`;
  const leaseDurationMs = Number(options.leaseDurationMs || 60_000);
  const staleAfterMs = Number(options.staleAfterMs || 5 * 60_000);
  const batchSize = Math.min(Math.max(Number(options.batchSize || 10), 1), 100);
  const pollIntervalMs = Number(options.pollIntervalMs || 30_000);
  const clock = options.clock || (() => new Date());
  const setIntervalImpl = options.setInterval || setInterval;
  const clearIntervalImpl = options.clearInterval || clearInterval;
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running) return { skipped: true, results: [] };
    running = true;
    const results = [];
    try {
      const now = nowDate(clock);
      const orders = await store.claimStaleOrders(workerId, {
        now,
        staleAfterMs,
        leaseDurationMs,
        limit: batchSize,
      });
      for (const order of orders) {
        try {
          results.push(await service.reconcileOrder(order.id, { source: "worker", actorId: workerId }));
        } catch (error) {
          results.push({ order, error });
          if (typeof store.recordPaymentEvent === "function") {
            await store.recordPaymentEvent({
              orderId: order.id,
              userId: order.userId,
              type: "reconcile_failed",
              actorId: workerId,
              message: error.message,
              metadata: { code: error.code || "PAYMENT_RECONCILIATION_FAILED" },
            });
          }
        } finally {
          await store.releaseOrderReconciliationLease(order.id, workerId, { reconciledAt: now });
        }
      }
      return { skipped: false, results };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setIntervalImpl(() => { void runOnce().catch(() => {}); }, Math.max(100, pollIntervalMs));
  }

  function stop() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
  }

  return { runOnce, start, stop };
}

module.exports = {
  createPaymentReconciliationService,
  createPaymentReconciliationWorker,
};
