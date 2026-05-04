export type ForgotPasswordEmailContent = {
    subject: string;
    text: string;
    html: string;
  };
  
  export function forgotPasswordEmail(params: {
    recipientName?: string;
    resetCode: string;
    minutesValid: number;
  }): ForgotPasswordEmailContent {
    const greeting = params.recipientName
      ? `Hello ${params.recipientName},`
      : "Hello,";
    const subject = "Your password reset code";
    const text = `${greeting}
  
  You requested a password reset. Use this code within ${params.minutesValid} minutes:
  
  ${params.resetCode}
  
  If you did not request this, you can ignore this email.
  
  `;
    const html = `<p>${greeting}</p>
  <p>You requested a password reset. Use this code within <strong>${params.minutesValid} minutes</strong>:</p>
  <p style="font-size:22px;letter-spacing:4px;font-weight:600;">${params.resetCode}</p>
  <p>If you did not request this, you can ignore this email.</p>`;
    return { subject, text, html };
  }
  
  export type InviteEmailContent = {
    subject: string;
    text: string;
    html: string;
  };
  
  export function inviteEmail(params: {
    orgName: string;
    signupLink: string;
    roleLabel: string;
    expiresAt: Date;
  }): InviteEmailContent {
    const subject = `You've been invited to ${params.orgName}`;
    const exp = params.expiresAt.toUTCString();
    const text = `You've been invited to join ${params.orgName} as ${params.roleLabel}.
  
  Use this link to complete signup (expires ${exp}):
  
  ${params.signupLink}
  
  `;
    const html = `<p>You've been invited to join <strong>${escapeHtml(params.orgName)}</strong> as <strong>${escapeHtml(params.roleLabel)}</strong>.</p>
  <p><a href="${hrefAttrSafe(params.signupLink)}">Complete signup</a></p>
  <p style="color:#555;font-size:13px;">This link expires ${escapeHtml(exp)}.</p>`;
    return { subject, text, html };
  }
  
  export type SetPasswordEmailContent = {
    subject: string;
    text: string;
    html: string;
  };
  
  export function setPasswordEmail(params: {
    recipientName?: string;
    setPasswordLink: string;
    expiresAt: Date;
  }): SetPasswordEmailContent {
    const greeting = params.recipientName
      ? `Hello ${params.recipientName},`
      : "Hello,";
    const subject = "Set your password";
    const exp = params.expiresAt.toUTCString();
    const text = `${greeting}
  
  Your account is ready. Open the link below to set your password (expires ${exp}):
  
  ${params.setPasswordLink}
  
  `;
    const html = `<p>${greeting}</p>
  <p>Your account is ready. Use the link below to set your password.</p>
  <p><a href="${hrefAttrSafe(params.setPasswordLink)}">Set your password</a></p>
  <p style="color:#555;font-size:13px;">This link expires ${escapeHtml(exp)}.</p>`;
    return { subject, text, html };
  }
  
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  
  /** Minimal quoting for double-quoted href attributes; does not rewrite URL query & */
  function hrefAttrSafe(url: string): string {
    return url.replace(/"/g, "&quot;").replace(/</g, "");
  }