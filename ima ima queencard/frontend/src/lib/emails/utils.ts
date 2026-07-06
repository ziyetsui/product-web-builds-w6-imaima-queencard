/**
 * Email Translation Utilities
 *
 * 提供邮件模板的翻译加载和使用功能
 */

export interface EmailTranslations {
  welcome: {
    subject: string;
    greeting: string;
    title: string;
    body: string;
    features: string;
    featuresList: {
      generate: string;
      models: string;
      share: string;
    };
    cta: string;
    footer: string;
    copyright: string;
  };
  resetPassword: {
    subject: string;
    greeting: string;
    title: string;
    body: string;
    instruction: string;
    button: string;
    validity: string;
    ignore: string;
    security: string;
    footer: string;
    copyright: string;
  };
}

/**
 * 获取指定语言的邮件翻译
 */
export async function getEmailTranslations(
  locale: string = "en"
): Promise<EmailTranslations> {
  return {
    welcome: {
      subject: locale.startsWith("zh") ? "欢迎使用 ima ima queencard" : "Welcome to ima ima queencard",
      greeting: locale.startsWith("zh") ? "你好" : "Hi",
      title: locale.startsWith("zh") ? "欢迎加入" : "Welcome aboard",
      body: locale.startsWith("zh") ? "你的账号已经准备好了。" : "Your account is ready.",
      features: locale.startsWith("zh") ? "你现在可以开始使用 ima ima queencard 创建图文。" : "You can start creating with ima ima queencard now.",
      featuresList: {
        generate: locale.startsWith("zh") ? "生成图文卡片" : "Generate visual cards",
        models: locale.startsWith("zh") ? "复用爆款结构" : "Reuse proven structures",
        share: locale.startsWith("zh") ? "导出并发布" : "Export and publish",
      },
      cta: locale.startsWith("zh") ? "开始使用" : "Start creating",
      footer: "ima ima queencard",
      copyright: "ima ima queencard",
    },
    resetPassword: {
      subject: locale.startsWith("zh") ? "重置你的密码" : "Reset your password",
      greeting: locale.startsWith("zh") ? "你好" : "Hi",
      title: locale.startsWith("zh") ? "重置密码" : "Reset password",
      body: locale.startsWith("zh") ? "点击下方按钮继续。" : "Click the button below to continue.",
      instruction: locale.startsWith("zh") ? "如果不是你本人操作，可以忽略这封邮件。" : "If this was not you, you can ignore this email.",
      button: locale.startsWith("zh") ? "重置密码" : "Reset password",
      validity: locale.startsWith("zh") ? "链接会在一段时间后失效。" : "This link will expire soon.",
      ignore: locale.startsWith("zh") ? "不是你？忽略即可。" : "Not you? Ignore this email.",
      security: locale.startsWith("zh") ? "为了安全，请不要转发此邮件。" : "For security, do not forward this email.",
      footer: "ima ima queencard",
      copyright: "ima ima queencard",
    },
  };
}

/**
 * 获取站点配置（用于邮件中的应用名称等）
 */
export async function getSiteConfig(locale?: string) {
  // 从 site config 导入
  const { siteConfig } = await import("@/config/site");
  return siteConfig;
}

/**
 * 渲染欢迎邮件（服务端使用）
 */
export async function renderWelcomeEmail(
  props: {
    name?: string;
    locale?: string;
    resetUrl?: string;
  }
) {
  const { WelcomeEmail } = await import("@/lib/emails/welcome-email");
  const translations = await getEmailTranslations(props.locale || "en");
  const siteConfig = await getSiteConfig(props.locale);

  return WelcomeEmail({
    name: props.name,
    locale: props.locale,
    translations: translations.welcome,
    appUrl: siteConfig.url,
  });
}

/**
 * 渲染密码重置邮件（服务端使用）
 */
export async function renderResetPasswordEmail(
  props: {
    name?: string;
    locale?: string;
    resetUrl: string;
  }
) {
  const { ResetPasswordEmail } = await import("@/lib/emails/reset-password-email");
  const translations = await getEmailTranslations(props.locale || "en");
  const siteConfig = await getSiteConfig(props.locale);

  return ResetPasswordEmail({
    name: props.name,
    locale: props.locale,
    translations: translations.resetPassword,
    resetUrl: props.resetUrl,
    appUrl: siteConfig.url,
  });
}

/**
 * 发送欢迎邮件
 *
 * @example
 * ```ts
 * await sendWelcomeEmail({
 *   to: "user@example.com",
 *   name: "John",
 *   locale: "en",
 * });
 * ```
 */
export async function sendWelcomeEmail(props: {
  to: string;
  name?: string;
  locale?: string;
}) {
  const { assertEmailSent, sendTransactionalEmail } = await import("@/lib/email");
  const siteConfig = await getSiteConfig(props.locale);

  const translations = await getEmailTranslations(props.locale || "en");
  const { WelcomeEmail } = await import("@/lib/emails/welcome-email");

  try {
    const sendResult = await sendTransactionalEmail({
      to: props.to,
      subject: translations.welcome.subject,
      react: WelcomeEmail({
        name: props.name,
        locale: props.locale,
        translations: translations.welcome,
        appUrl: siteConfig.url,
      }),
      headers: {
        "X-Entity-Ref-ID": new Date().getTime() + "",
      },
    });
    assertEmailSent(sendResult);

    return { success: true };
  } catch (error) {
    console.error("Failed to send welcome email:", error);
    return { success: false, error };
  }
}

/**
 * 发送密码重置邮件
 *
 * @example
 * ```ts
 * await sendResetPasswordEmail({
 *   to: "user@example.com",
 *   name: "John",
 *   resetUrl: "https://videofly.app/reset-password?token=xxx",
 *   locale: "en",
 * });
 * ```
 */
export async function sendResetPasswordEmail(props: {
  to: string;
  name?: string;
  resetUrl: string;
  locale?: string;
}) {
  const { assertEmailSent, sendTransactionalEmail } = await import("@/lib/email");
  const siteConfig = await getSiteConfig(props.locale);

  const translations = await getEmailTranslations(props.locale || "en");
  const { ResetPasswordEmail } = await import("@/lib/emails/reset-password-email");

  try {
    const sendResult = await sendTransactionalEmail({
      to: props.to,
      subject: translations.resetPassword.subject,
      react: ResetPasswordEmail({
        name: props.name,
        locale: props.locale,
        translations: translations.resetPassword,
        resetUrl: props.resetUrl,
        appUrl: siteConfig.url,
      }),
      headers: {
        "X-Entity-Ref-ID": new Date().getTime() + "",
      },
    });
    assertEmailSent(sendResult);

    return { success: true };
  } catch (error) {
    console.error("Failed to send reset password email:", error);
    return { success: false, error };
  }
}
