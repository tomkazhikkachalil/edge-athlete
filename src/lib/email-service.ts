import nodemailer from 'nodemailer';

// Email clients need absolute image URLs — no relative paths.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';

const logoHeader = (base: string) =>
  `<img src="${base}/logo.png" width="140" alt="Edge Athlete" style="display:block;margin:0 0 16px;" />`;

interface ContactEmailData {
  name: string;
  email: string;
  message: string;
}

// Escape user-supplied text before interpolating into email HTML.
function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Simple email service for contact forms
 * No auth or database required - just sends emails
 */
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  /**
   * Send contact form email
   */
  async sendContactEmail(data: ContactEmailData): Promise<void> {
    const { name, email, message } = data;
    
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${logoHeader(APP_URL)}
        <h2 style="color: #6d28d9;">New Contact Form Submission</h2>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        </div>
        
        <div style="background: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h3 style="color: #333; margin-top: 0;">Message:</h3>
          <p style="line-height: 1.6; color: #555;">${escapeHtml(message)}</p>
        </div>
        
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #888; font-size: 12px;">
          <p>This email was sent from your website's contact form.</p>
        </div>
      </div>
    `;

    const textContent = `
New Contact Form Submission

Name: ${name}
Email: ${email}

Message:
${message}

---
This email was sent from your website's contact form.
    `;

    await this.transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@yourdomain.com',
      to: process.env.CONTACT_EMAIL || process.env.EMAIL_FROM,
      subject: `Contact Form: Message from ${name}`,
      text: textContent,
      html: htmlContent,
      replyTo: email, // Allow replying directly to the person who submitted
    });
  }

  /**
   * Notify the site owner of a new waitlist signup. Best-effort — callers
   * should not fail the request if this throws.
   */
  async sendWaitlistNotification(email: string, userType: string): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@yourdomain.com',
      to: process.env.CONTACT_EMAIL || process.env.EMAIL_FROM,
      subject: `Waitlist signup: ${userType}`,
      text: `New waitlist signup\n\nEmail: ${email}\nInterested as: ${userType}\n\n— Edge Athlete`,
    });
  }

  /**
   * Notification digest — a summary of a user's recent unread activity.
   * Sent to the user's own email (opt-in via notification_preferences).
   */
  async sendNotificationDigest(
    to: string,
    displayName: string,
    items: Array<{ title: string; created_at: string }>,
    appUrl: string
  ): Promise<void> {
    const count = items.length;
    const rows = items
      .slice(0, 10)
      .map(
        i => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#333;font-size:14px;">${escapeHtml(i.title)}</td></tr>`
      )
      .join('');
    const more = count > 10 ? `<p style="color:#888;font-size:13px;">…and ${count - 10} more.</p>` : '';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${logoHeader(appUrl)}
        <h2 style="color:#6d28d9;">Hi ${escapeHtml(displayName || 'there')},</h2>
        <p style="color:#333;font-size:15px;">You have ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">${rows}</table>
        ${more}
        <a href="${appUrl}/app/notifications"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
          View on Edge Athlete
        </a>
        <p style="color:#aaa;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
          You're receiving this because email digests are on. Turn them off any time in
          Settings → Notifications.
        </p>
      </div>
    `;

    const textContent =
      `Hi ${displayName || 'there'},\n\nYou have ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete:\n\n` +
      items.slice(0, 10).map(i => `• ${i.title}`).join('\n') +
      (count > 10 ? `\n…and ${count - 10} more.` : '') +
      `\n\nView: ${appUrl}/app/notifications\n\nTurn off digests in Settings → Notifications.`;

    await this.transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@yourdomain.com',
      to,
      subject: `You have ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete`,
      text: textContent,
      html: htmlContent,
    });
  }

  /**
   * Test email connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      // Email connection failed
      return false;
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();