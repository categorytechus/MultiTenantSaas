import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import {
  forgotPasswordEmail,
  inviteEmail,
  setPasswordEmail,
} from "./email-templates";

const trimmedFrom = (): string =>
  (process.env.SES_FROM_EMAIL ?? "").trim();

/**
 * True when SES_FROM_EMAIL is set to a real sender (not empty / "mock").
 * IAM/credentials are expected from the environment (e.g. IRSA on EKS, instance role on EC2).
 */
export function isSesConfigured(): boolean {
  const from = trimmedFrom();
  if (!from) return false;
  if (/^mock$/i.test(from)) return false;
  return true;
}

function sesClient(): SESClient {
  return new SESClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
}

async function sendHtmlEmail(
  to: string,
  subject: string,
  textBody: string,
  htmlBody: string,
): Promise<void> {
  if (!isSesConfigured()) {
    return;
  }
  const from = trimmedFrom();
  await sesClient().send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: textBody, Charset: "UTF-8" },
          Html: { Data: htmlBody, Charset: "UTF-8" },
        },
      },
    }),
  );
}

export async function sendForgotPasswordEmail(params: {
  to: string;
  recipientName?: string;
  resetCode: string;
  minutesValid: number;
}): Promise<void> {
  const { subject, text, html } = forgotPasswordEmail({
    recipientName: params.recipientName,
    resetCode: params.resetCode,
    minutesValid: params.minutesValid,
  });
  await sendHtmlEmail(params.to, subject, text, html);
}

export async function sendInviteEmail(params: {
  to: string;
  orgName: string;
  signupLink: string;
  roleLabel: string;
  expiresAt: Date;
}): Promise<void> {
  const { subject, text, html } = inviteEmail({
    orgName: params.orgName,
    signupLink: params.signupLink,
    roleLabel: params.roleLabel,
    expiresAt: params.expiresAt,
  });
  await sendHtmlEmail(params.to, subject, text, html);
}

export async function sendSetPasswordEmail(params: {
  to: string;
  recipientName?: string;
  setPasswordLink: string;
  expiresAt: Date;
}): Promise<void> {
  const { subject, text, html } = setPasswordEmail({
    recipientName: params.recipientName,
    setPasswordLink: params.setPasswordLink,
    expiresAt: params.expiresAt,
  });
  await sendHtmlEmail(params.to, subject, text, html);
}
