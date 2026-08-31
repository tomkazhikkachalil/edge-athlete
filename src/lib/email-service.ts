import nodemailer from 'nodemailer';
import * as Sentry from '@sentry/nextjs';

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
/**
 * Sender address for every outbound mail. EMAIL_FROM when set; otherwise the
 * SMTP account itself — a real, deliverable address. The old fallback was a
 * literal 'noreply@yourdomain.com', which would have leaked a placeholder
 * domain into real headers the moment EMAIL_FROM was unset.
 */
function fromAddress(): string {
  return process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@invalid.local';
}

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
      // A wedged SMTP handshake must not hold a serverless function open.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  /**
   * Send with a RESULT instead of a throw: callers get an honest emailSent
   * boolean (SMTP creds being SET does not mean sends succeed — an
   * unverified sender domain 550s every message). Failures log + Sentry-tag
   * so a dead mail pipe is visible.
   */
  private async deliver(kind: string, mail: Parameters<nodemailer.Transporter['sendMail']>[0]): Promise<boolean> {
    try {
      await this.transporter.sendMail(mail);
      return true;
    } catch (err) {
      console.error(`[EMAIL] send failed (${kind}):`, err);
      Sentry.captureException(err, { tags: { area: 'email', email_kind: kind } });
      return false;
    }
  }

  /**
   * Send contact form email
   */
  async sendContactEmail(data: ContactEmailData): Promise<boolean> {
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

    return this.deliver('contact', {
      from: fromAddress(),
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
      from: fromAddress(),
      to: process.env.CONTACT_EMAIL || process.env.EMAIL_FROM,
      subject: `Waitlist signup: ${userType}`,
      text: `New waitlist signup\n\nEmail: ${email}\nInterested as: ${userType}\n\n— Edge Athlete`,
    });
  }

  /**
   * Guardian invite — sent to a parent/guardian when a minor athlete tried
   * to sign up (or an existing guardian invites a co-guardian). The link
   * carries the raw single-use token; appUrl is a parameter (cron/preview
   * safe, matches sendNotificationDigest).
   */
  async sendGuardianInvite(
    to: string,
    athleteFirstName: string,
    inviteUrl: string,
    appUrl: string,
    guardianHasAccount = false
  ): Promise<boolean> {
    const cta = guardianHasAccount
      ? 'Log in and review their request'
      : 'Review and set up their profile';
    const name = athleteFirstName ? escapeHtml(athleteFirstName) : 'A young athlete';
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${logoHeader(appUrl)}
        <h2 style="color:#6d28d9;">${name} wants to join Edge Athlete</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;">
          Edge Athlete requires a parent or guardian to set up and manage
          accounts for young athletes. If you're their parent or guardian,
          you can review the request and create their profile — you'll stay
          in control of their privacy, content, and who can contact them.
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
          ${cta}
        </a>
        <p style="color:#888;font-size:12px;margin-top:16px;">
          This link is single-use and expires in 7 days. If you weren't
          expecting this email, you can ignore it — no account was created.
        </p>
        <div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px;">
          <p>— Edge Athlete</p>
        </div>
      </div>
    `;
    return this.deliver('guardian_invite', {
      from: fromAddress(),
      to,
      subject: `Action needed: ${athleteFirstName || 'a young athlete'} wants to join Edge Athlete`,
      html: htmlContent,
      text: `${athleteFirstName || 'A young athlete'} wants to join Edge Athlete.\n\nEdge Athlete requires a parent or guardian to set up accounts for young athletes. Review the request here (single-use link, expires in 7 days):\n\n${inviteUrl}\n\nIf you weren't expecting this email, you can ignore it — no account was created.\n\n— Edge Athlete`,
    });
  }

  /** Org claim invite (phase 1 round 2): an org named this one as a
   *  partner; the recipient claims ownership of the pre-built page.
   *  Single-use link, 30-day expiry — copy mirrors sendGuardianInvite. */
  async sendOrgClaimInvite(
    to: string,
    stubOrgName: string,
    inviterOrgName: string,
    claimUrl: string
  ): Promise<boolean> {
    const stub = escapeHtml(stubOrgName);
    const inviter = escapeHtml(inviterOrgName);
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color:#6d28d9;">${inviter} added ${stub} on Edge Athlete</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;">
          ${inviter} listed ${stub} as one of its partner organizations, so
          we created a page for it. If you run ${stub}, you can claim the
          page and take ownership — rosters, schedules, and your public
          presence, all in one place.
        </p>
        <a href="${claimUrl}"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
          Claim ${stub}
        </a>
        <p style="color:#888;font-size:12px;margin-top:16px;">
          This link is single-use and expires in 30 days. If this isn't your
          organization, you can ignore this email — nothing else changes.
        </p>
        <div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px;">
          <p>— Edge Athlete</p>
        </div>
      </div>
    `;
    return this.deliver('org_claim_invite', {
      from: fromAddress(),
      to,
      subject: `${inviterOrgName} added ${stubOrgName} on Edge Athlete — claim your page`,
      html: htmlContent,
      text: `${inviterOrgName} listed ${stubOrgName} as a partner organization on Edge Athlete, and a page was created for it.\n\nIf you run ${stubOrgName}, claim the page here (single-use link, expires in 30 days):\n\n${claimUrl}\n\nIf this isn't your organization, you can ignore this email.\n\n— Edge Athlete`,
    });
  }

  /**
   * Calendar event invitation for an EMAIL invitee (not an app user yet) —
   * read-only v1: full details + a join-the-app path. Registered guests get
   * in-app notifications instead, never this email. whenText is formatted
   * server-side in the event's own time zone (email has no browser tz).
   */
  async sendEventInvite(
    to: string,
    data: {
      organizerName: string;
      title: string;
      whenText: string;
      timezone: string;
      location?: string | null;
      description?: string | null;
      recurrenceText?: string | null;
    },
    appUrl: string
  ): Promise<void> {
    const organizer = escapeHtml(data.organizerName);
    const title = escapeHtml(data.title);
    const detailRows = [
      `<p style="color:#333;font-size:15px;margin:4px 0;"><strong>When:</strong> ${escapeHtml(data.whenText)} (${escapeHtml(data.timezone)})</p>`,
      data.recurrenceText ? `<p style="color:#333;font-size:15px;margin:4px 0;"><strong>${escapeHtml(data.recurrenceText)}</strong></p>` : '',
      data.location ? `<p style="color:#333;font-size:15px;margin:4px 0;"><strong>Where:</strong> ${escapeHtml(data.location)}</p>` : '',
      data.description ? `<p style="color:#333;font-size:15px;margin:4px 0;"><strong>Details:</strong> ${escapeHtml(data.description)}</p>` : '',
    ].join('');
    await this.transporter.sendMail({
      from: fromAddress(),
      to,
      subject: `Invitation: ${data.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${logoHeader(appUrl)}
          <h2 style="color:#6d28d9;">${organizer} invited you to ${title}</h2>
          ${detailRows}
          <p style="color:#333;font-size:15px;line-height:1.6;margin-top:12px;">
            To respond and see updates, join Edge Athlete with this email
            address — the event will be waiting on your calendar.
          </p>
          <a href="${appUrl}/"
             style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
            Join Edge Athlete
          </a>
          <div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px;">
            <p>— Edge Athlete</p>
          </div>
        </div>
      `,
      text: `${data.organizerName} invited you to ${data.title}\n\nWhen: ${data.whenText} (${data.timezone})${data.recurrenceText ? `\n${data.recurrenceText}` : ''}${data.location ? `\nWhere: ${data.location}` : ''}${data.description ? `\nDetails: ${data.description}` : ''}\n\nTo respond and see updates, join Edge Athlete with this email address: ${appUrl}/\n\n— Edge Athlete`,
    });
  }

  /**
   * Calendar event cancellation for an EMAIL invitee.
   */
  async sendEventCancelled(
    to: string,
    data: { organizerName: string; title: string; whenText: string },
    appUrl: string
  ): Promise<void> {
    await this.transporter.sendMail({
      from: fromAddress(),
      to,
      subject: `Cancelled: ${data.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${logoHeader(appUrl)}
          <h2 style="color:#6d28d9;">${escapeHtml(data.title)} was cancelled</h2>
          <p style="color:#333;font-size:15px;line-height:1.6;">
            ${escapeHtml(data.organizerName)} cancelled this event
            (${escapeHtml(data.whenText)}). No action is needed.
          </p>
          <div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px;">
            <p>— Edge Athlete</p>
          </div>
        </div>
      `,
      text: `${data.title} was cancelled.\n\n${data.organizerName} cancelled this event (${data.whenText}). No action is needed.\n\n— Edge Athlete`,
    });
  }

  /**
   * Co-guardian invite — an existing guardian or support invites another
   * adult to become the guardian of an EXISTING supervised profile (second
   * guardian, or orphan-profile takeover). The link carries the raw
   * single-use token.
   */
  async sendCoGuardianInvite(
    to: string,
    athleteFirstName: string,
    inviteUrl: string,
    appUrl: string,
    // Wave 8 (mig 138): 'viewer' invites grant a view-only seat — the copy
    // must promise exactly that, never guardian powers.
    role: 'guardian' | 'viewer' = 'guardian'
  ): Promise<boolean> {
    const name = athleteFirstName ? escapeHtml(athleteFirstName) : 'a young athlete';
    const heading = role === 'viewer'
      ? `You've been invited to follow ${name}'s journey`
      : `You've been invited to help manage ${name}'s profile`;
    const bodyHtml = role === 'viewer'
      ? `A guardian of ${name} invited you to a view-only seat on their
          family console: you'll see ${name}'s schedule and family updates,
          without any of the guardian controls.`
      : `${name} has an athlete profile on Edge Athlete that needs a parent
          or guardian. Accepting makes you their guardian — you'll review
          their profile, approve what gets posted, and manage their privacy
          and who can contact them.`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${logoHeader(appUrl)}
        <h2 style="color:#6d28d9;">${heading}</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;">
          ${bodyHtml}
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
          Accept the invite
        </a>
        <p style="color:#888;font-size:12px;margin-top:16px;">
          This link is single-use and expires in 7 days. If you weren't
          expecting this email, you can ignore it — nothing changes without
          your acceptance.
        </p>
        <div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px;">
          <p>— Edge Athlete</p>
        </div>
      </div>
    `;
    const plainName = athleteFirstName || 'a young athlete';
    return this.deliver('co_guardian_invite', {
      from: fromAddress(),
      to,
      subject: role === 'viewer'
        ? `You've been invited to follow ${plainName}'s Edge Athlete journey`
        : `You've been invited to help manage ${plainName}'s Edge Athlete profile`,
      html: htmlContent,
      text: role === 'viewer'
        ? `A guardian of ${plainName} invited you to a view-only seat on their family console: you'll see their schedule and family updates, without any guardian controls. Accept here (single-use link, expires in 7 days):\n\n${inviteUrl}\n\nIf you weren't expecting this email, you can ignore it — nothing changes without your acceptance.\n\n— Edge Athlete`
        : `${athleteFirstName || 'A young athlete'} has an athlete profile on Edge Athlete that needs a parent or guardian.\n\nAccepting makes you their guardian — you'll review their profile, approve what gets posted, and manage their privacy. Accept here (single-use link, expires in 7 days):\n\n${inviteUrl}\n\nIf you weren't expecting this email, you can ignore it — nothing changes without your acceptance.\n\n— Edge Athlete`,
    });
  }

  /**
   * Account activation after a completed transfer of control — the new
   * owner's "the account is yours" email. The link carries the raw
   * single-use athlete_activation token.
   */
  async sendAccountActivation(to: string, activationUrl: string, appUrl: string): Promise<boolean> {
    return this.deliver('account_activation', {
      from: fromAddress(),
      to,
      subject: 'Your Edge Athlete account is now yours',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${logoHeader(appUrl)}
          <h2 style="color:#6d28d9;">Congratulations — your account is officially yours</h2>
          <p style="color:#333;font-size:15px;line-height:1.6;">
            The handover is complete. Your Edge Athlete account now belongs to
            you. Set a password to sign in and take a quick look at your
            privacy settings — it takes less than a minute.
          </p>
          <a href="${activationUrl}"
             style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
            Set your password
          </a>
          <p style="color:#888;font-size:12px;margin-top:16px;">
            This link is single-use and expires in 7 days. If it expires, you
            can always sign in by resetting your password at
            ${appUrl}/forgot-password using this email address.
          </p>
          <div style="margin-top:20px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px;">
            <p>— Edge Athlete</p>
          </div>
        </div>
      `,
      text: `Congratulations — your Edge Athlete account is officially yours.\n\nThe handover is complete. Set a password to sign in (single-use link, expires in 7 days):\n\n${activationUrl}\n\nIf the link expires, you can always sign in by resetting your password at ${appUrl}/forgot-password using this email address.\n\n— Edge Athlete`,
    });
  }

  /**
   * Transfer contact-verification code (guardian-profiles transfer flow).
   */
  async sendTransferCode(to: string, code: string, appUrl: string): Promise<boolean> {
    return this.deliver('transfer_code', {
      from: fromAddress(),
      to,
      subject: `${code} is your Edge Athlete verification code`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${logoHeader(appUrl)}
          <h2 style="color:#6d28d9;">Verify your email</h2>
          <p style="color:#333;font-size:15px;">Enter this code to confirm this email belongs to you:</p>
          <p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#111;">${escapeHtml(code)}</p>
          <p style="color:#888;font-size:12px;">The code expires in 15 minutes. If you weren't expecting this, ignore it.</p>
        </div>
      `,
      text: `${code} is your Edge Athlete verification code. It expires in 15 minutes.`,
    });
  }

  /**
   * Notification digest, grouped per athlete (Wave 5 — replaces the old
   * flat sendNotificationDigest). A guardian's digest leads with each
   * child's section ("For Junior"), their own activity under "For you"; a
   * user with a SINGLE unnamed group gets the flat classic rendering, so
   * ordinary adults share this template unchanged. Each group caps at 10
   * titles + "…and N more". deliver()-backed — the caller gates the
   * watermark on the boolean (the old adult path was a raw sendMail that
   * only worked by accidental throw-unwind).
   */
  async sendGuardianDigest(
    to: string,
    displayName: string,
    groups: Array<{ childName: string | null; items: Array<{ title: string }> }>,
    appUrl: string
  ): Promise<boolean> {
    const count = groups.reduce((sum, g) => sum + g.items.length, 0);
    const flat = groups.length === 1 && groups[0].childName === null;

    const renderRows = (items: Array<{ title: string }>) =>
      items
        .slice(0, 10)
        .map(
          i => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#333;font-size:14px;">${escapeHtml(i.title)}</td></tr>`
        )
        .join('');
    const renderMore = (n: number) =>
      n > 10 ? `<p style="color:#888;font-size:13px;">…and ${n - 10} more.</p>` : '';

    const sections = flat
      ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;">${renderRows(groups[0].items)}</table>${renderMore(groups[0].items.length)}`
      : groups
          .map(
            g => `
        <h3 style="color:#111;font-size:15px;margin:20px 0 4px;">${g.childName ? `For ${escapeHtml(g.childName)}` : 'For you'}</h3>
        <table style="width:100%;border-collapse:collapse;margin:4px 0;">${renderRows(g.items)}</table>
        ${renderMore(g.items.length)}`
          )
          .join('');

    const cta = flat ? `${appUrl}/app/notifications` : `${appUrl}/app/guardian`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${logoHeader(appUrl)}
        <h2 style="color:#6d28d9;">Hi ${escapeHtml(displayName || 'there')},</h2>
        <p style="color:#333;font-size:15px;">You have ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete:</p>
        ${sections}
        <a href="${cta}"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
          ${flat ? 'View on Edge Athlete' : 'Open the family console'}
        </a>
        <p style="color:#aaa;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
          You're receiving this because email digests are on. Turn them off any time in
          Settings → Notifications.
        </p>
      </div>
    `;

    const textSections = groups
      .map(g => {
        const header = flat ? '' : `${g.childName ? `For ${g.childName}` : 'For you'}:\n`;
        return (
          header +
          g.items.slice(0, 10).map(i => `• ${i.title}`).join('\n') +
          (g.items.length > 10 ? `\n…and ${g.items.length - 10} more.` : '')
        );
      })
      .join('\n\n');
    const textContent =
      `Hi ${displayName || 'there'},\n\nYou have ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete:\n\n` +
      textSections +
      `\n\nView: ${cta}\n\nTurn off digests in Settings → Notifications.`;

    return this.deliver('guardian_digest', {
      from: fromAddress(),
      to,
      subject: `You have ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete`,
      text: textContent,
      html: htmlContent,
    });
  }

  /**
   * Urgent safety alert (Wave 5, mig 135) — safety_alert/consent_result
   * rows mailed within ~10 minutes by /api/cron/urgent-emails, one email
   * per guardian per sweep. Links are pre-filtered to app-internal paths
   * by the caller (safeInternalPath); the footer names the toggle.
   */
  async sendUrgentAlert(
    to: string,
    displayName: string,
    items: Array<{ title: string; message?: string | null; path?: string | null }>,
    appUrl: string
  ): Promise<boolean> {
    const count = items.length;
    const subject =
      count === 1
        ? `Safety alert: ${items[0].title}`
        : `${count} safety alerts on Edge Athlete`;
    const rows = items
      .slice(0, 10)
      .map(i => {
        const title = i.path
          ? `<a href="${appUrl}${i.path}" style="color:#6d28d9;text-decoration:none;font-weight:bold;">${escapeHtml(i.title)}</a>`
          : `<strong>${escapeHtml(i.title)}</strong>`;
        const message = i.message
          ? `<br /><span style="color:#555;font-size:13px;">${escapeHtml(i.message)}</span>`
          : '';
        return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#333;font-size:14px;">${title}${message}</td></tr>`;
      })
      .join('');
    const more = count > 10 ? `<p style="color:#888;font-size:13px;">…and ${count - 10} more.</p>` : '';

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        ${logoHeader(appUrl)}
        <h2 style="color:#6d28d9;">Hi ${escapeHtml(displayName || 'there')},</h2>
        <p style="color:#333;font-size:15px;">
          Something on your family console needs your attention:
        </p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">${rows}</table>
        ${more}
        <a href="${appUrl}/app/guardian"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
          Open the family console
        </a>
        <p style="color:#aaa;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
          You're receiving this because urgent safety emails are on. Turn them
          off any time in Settings → Notifications ("Urgent safety emails").
          The daily digest still summarizes everything either way.
        </p>
      </div>
    `;
    const textContent =
      `Hi ${displayName || 'there'},\n\nSomething on your family console needs your attention:\n\n` +
      items
        .slice(0, 10)
        .map(i => `• ${i.title}${i.message ? ` — ${i.message}` : ''}${i.path ? `\n  ${appUrl}${i.path}` : ''}`)
        .join('\n') +
      (count > 10 ? `\n…and ${count - 10} more.` : '') +
      `\n\nFamily console: ${appUrl}/app/guardian\n\nTurn off urgent safety emails in Settings → Notifications.`;

    return this.deliver('urgent_alert', {
      from: fromAddress(),
      to,
      subject,
      text: textContent,
      html: htmlContent,
    });
  }

  /**
   * A supervised athlete's digest, routed to their GUARDIAN (the child's
   * synthetic address can never receive mail). Same shape as
   * sendNotificationDigest with honest recipient copy — the guardian is
   * reading about the child, not about themselves.
   */
  async sendChildDigest(
    to: string,
    childFirstName: string,
    items: Array<{ title: string; created_at: string }>,
    appUrl: string
  ): Promise<boolean> {
    const count = items.length;
    const name = escapeHtml(childFirstName || 'Your athlete');
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
        <h2 style="color:#6d28d9;">${name} has ${count} new notification${count === 1 ? '' : 's'}</h2>
        <p style="color:#333;font-size:15px;">
          You manage ${name}'s Edge Athlete profile, so their activity comes to you:
        </p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">${rows}</table>
        ${more}
        <a href="${appUrl}/app/guardian"
           style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;margin-top:8px;">
          Open the family console
        </a>
        <p style="color:#aaa;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
          You're receiving this as ${name}'s guardian. This routing ends when
          their account is handed over to them.
        </p>
      </div>
    `;

    const textContent =
      `${childFirstName || 'Your athlete'} has ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete:\n\n` +
      items.slice(0, 10).map(i => `• ${i.title}`).join('\n') +
      (count > 10 ? `\n…and ${count - 10} more.` : '') +
      `\n\nFamily console: ${appUrl}/app/guardian`;

    // deliver(), not raw sendMail (Round E): a thrown SMTP failure used to
    // land in digest-server's per-user catch, freeze the watermark, and
    // re-send this digest to every guardian on every subsequent run.
    return this.deliver('child_digest', {
      from: fromAddress(),
      to,
      subject: `${childFirstName || 'Your athlete'} has ${count} new notification${count === 1 ? '' : 's'} on Edge Athlete`,
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