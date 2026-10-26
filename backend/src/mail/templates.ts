import type { MailMessage } from './mail.service';

/**
 * Email bodies.
 *
 * Table-based layout with inline styles, because email clients are a decade
 * behind browsers — flexbox, grid and <style> blocks are all unreliable in
 * Outlook. Every message ships a plain-text part too: some clients block HTML
 * outright, and a password reset that arrives as a blank message is a support
 * ticket.
 */

const BRAND = '#46178f';

function layout(heading: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px;">
          <tr><td>
            <p style="margin:0 0 24px;font-size:26px;font-weight:800;color:${BRAND};">Feyi</p>
            <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">${heading}</h1>
            <div style="font-size:15px;line-height:1.6;color:#475569;">${body}</div>
            ${
              cta
                ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                     <tr><td style="border-radius:12px;background:${BRAND};">
                       <a href="${cta.url}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${cta.label}</a>
                     </td></tr>
                   </table>
                   <p style="margin:0 0 8px;font-size:13px;color:#64748b;">If the button doesn't work, paste this into your browser:</p>
                   <p style="margin:0;font-size:13px;word-break:break-all;color:${BRAND};">${cta.url}</p>`
                : ''
            }
          </td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">Feyi — learning, but make it a game</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function passwordResetEmail(to: string, url: string, minutes: number): MailMessage {
  return {
    to,
    subject: 'Reset your Feyi password',
    html: layout(
      'Reset your password',
      `<p style="margin:0 0 12px;">We got a request to reset the password for this account.</p>
       <p style="margin:0;">This link works once and expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email — nothing has changed.</p>`,
      { label: 'Choose a new password', url },
    ),
    text: [
      'Reset your Feyi password',
      '',
      'We got a request to reset the password for this account.',
      `This link works once and expires in ${minutes} minutes:`,
      url,
      '',
      "If you didn't ask for this, you can ignore this email — nothing has changed.",
    ].join('\n'),
  };
}

/**
 * Sent after a successful reset. This is the message that actually catches an
 * account takeover: if it lands and the owner didn't do it, they know at once.
 */
export function passwordChangedEmail(to: string): MailMessage {
  return {
    to,
    subject: 'Your Feyi password was changed',
    html: layout(
      'Your password was changed',
      `<p style="margin:0 0 12px;">The password for this account has just been changed, and everywhere you were signed in has been signed out.</p>
       <p style="margin:0;"><strong>If this wasn't you</strong>, reset your password immediately and check your email account too.</p>`,
    ),
    text: [
      'Your Feyi password was changed',
      '',
      'The password for this account has just been changed, and everywhere you were signed in has been signed out.',
      "If this wasn't you, reset your password immediately and check your email account too.",
    ].join('\n'),
  };
}
