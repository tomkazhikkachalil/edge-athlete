import nodemailer from 'nodemailer';

interface ContactEmailData {
  name: string;
  email: string;
  message: string;
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
        <h2 style="color: #333;">New Contact Form Submission</h2>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
        </div>
        
        <div style="background: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h3 style="color: #333; margin-top: 0;">Message:</h3>
          <p style="line-height: 1.6; color: #555;">${message}</p>
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
   * Test email connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      // Email connection failed
      return false;
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();