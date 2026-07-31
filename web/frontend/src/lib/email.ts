import type { ReactElement } from "react";
import { render } from "@react-email/render";
import { Resend } from "resend";

import { env } from "@/lib/auth/env.mjs";

const ZEABUR_EMAIL_API_URL =
  env.ZEABUR_EMAIL_API_URL || "https://api.zeabur.com/api/v1/zsend/emails";

type EmailProvider = "resend" | "zeabur";

type EmailSendError = {
  name?: string;
  message?: string;
};

type EmailSendResult = {
  data: unknown;
  error: EmailSendError | null;
};

type TransactionalEmailPayload = {
  from?: string;
  to: string | string[];
  subject: string;
  react?: ReactElement;
  html?: string;
  text?: string;
  headers?: Record<string, string>;
};

let resendClient: Resend | null = null;

function getEmailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER) return env.EMAIL_PROVIDER;
  return env.ZEABUR_EMAIL_API_KEY ? "zeabur" : "resend";
}

function getResendClient() {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend.");
  }

  resendClient ??= new Resend(env.RESEND_API_KEY);
  return resendClient;
}

function normalizeRecipients(to: string | string[]) {
  return Array.isArray(to) ? to : [to];
}

function getSender(payload: TransactionalEmailPayload, provider: EmailProvider) {
  const sender =
    payload.from ||
    (provider === "zeabur" ? env.ZEABUR_EMAIL_FROM : env.RESEND_FROM) ||
    env.RESEND_FROM ||
    env.ZEABUR_EMAIL_FROM;

  if (!sender) {
    throw new Error(
      provider === "zeabur"
        ? "ZEABUR_EMAIL_FROM is required when EMAIL_PROVIDER=zeabur."
        : "RESEND_FROM is required when EMAIL_PROVIDER=resend."
    );
  }

  return sender;
}

async function renderEmailHtml(payload: TransactionalEmailPayload) {
  if (payload.html) return payload.html;
  if (payload.react) return render(payload.react);
  return undefined;
}

async function sendWithZeabur(
  payload: TransactionalEmailPayload
): Promise<EmailSendResult> {
  if (!env.ZEABUR_EMAIL_API_KEY) {
    throw new Error("ZEABUR_EMAIL_API_KEY is required when EMAIL_PROVIDER=zeabur.");
  }

  const html = await renderEmailHtml(payload);
  const response = await fetch(ZEABUR_EMAIL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ZEABUR_EMAIL_API_KEY}`,
    },
    body: JSON.stringify({
      from: getSender(payload, "zeabur"),
      to: normalizeRecipients(payload.to),
      subject: payload.subject,
      html,
      text: payload.text,
      headers: payload.headers,
    }),
  });

  const body = await response
    .json()
    .catch(async () => ({ message: await response.text().catch(() => "") }));

  if (!response.ok) {
    const maybeBody = body as { error?: string; message?: string };
    return {
      data: null,
      error: {
        name: "zeabur_email_error",
        message:
          maybeBody.message ||
          maybeBody.error ||
          `Zeabur Email request failed with HTTP ${response.status}.`,
      },
    };
  }

  return { data: body, error: null };
}

async function sendWithResend(
  payload: TransactionalEmailPayload
): Promise<EmailSendResult> {
  const resend = getResendClient();
  return resend.emails.send({
    from: getSender(payload, "resend"),
    to: payload.to,
    subject: payload.subject,
    react: payload.react,
    html: payload.html,
    text: payload.text,
    headers: payload.headers,
  });
}

export async function sendTransactionalEmail(
  payload: TransactionalEmailPayload
) {
  const provider = getEmailProvider();
  return provider === "zeabur"
    ? sendWithZeabur(payload)
    : sendWithResend(payload);
}

export function assertEmailSent(result: EmailSendResult) {
  if (!result.error) return result.data;

  const name = result.error.name || "email_provider_error";
  const message =
    result.error.message || "Email provider rejected the send request.";

  throw new Error(`[${name}] ${message}`);
}
