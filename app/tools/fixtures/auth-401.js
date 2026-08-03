function runAuth401Fixture(dependencies) {
  var session = dependencies.session;
  var navigate = dependencies.navigate;
  var error = dependencies.error || { statusCode: 401, code: "SESSION_EXPIRED" };

  if (error.statusCode !== 401) return { cleared: false, redirected: false };
  session.clearSession();
  navigate("/pages/account/index?auth=required");
  return { cleared: true, redirected: true };
}

module.exports = {
  runAuth401Fixture: runAuth401Fixture,
};
