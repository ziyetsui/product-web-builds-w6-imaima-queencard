function assertAssetStorage(storage) {
  const methods = ["put", "head", "getSignedDownloadUrl", "delete"];
  const missing = methods.filter((method) => typeof storage?.[method] !== "function");
  if (missing.length) throw new TypeError(`AssetStorage is missing: ${missing.join(", ")}`);
  return storage;
}

function assetStorageError(message, code = "ASSET_STORAGE_ERROR", status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

module.exports = {
  assertAssetStorage,
  assetStorageError,
};
