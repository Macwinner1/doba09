import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Outbound email.
 *
 * Speaks plain SMTP, which works with every provider worth using — and in
 * Nigeria that matters, because the convenient API-only services are not all
 * reliably reachable or affordable.
 *
 * With no SMTP configured it falls back to logging the message. That keeps the
 * project runnable straight from a clone: a developer can complete a password
 * reset locally without signing up for anything, because the link is printed to
 * the console. It is refused in production — silently swallowing a password
 * reset there would be far worse than failing loudly.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private from!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const host = this.config.get<string>('SMTP_HOST');
    this.from = this.config.get<string>('MAIL_FROM') ?? 'Feyi <no-reply@feyi.local>';

    if (!host) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error(
          'SMTP_HOST is required in production — refusing to start with no way to send password resets',
        );
      }
      this.logger.warn('No SMTP_HOST set; emails will be printed to the console');
      return;
    }

    const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      // 465 is implicit TLS; 587 upgrades via STARTTLS.
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    this.logger.log(`SMTP configured: ${host}:${port}`);
  }

  /**
   * Never throws.
   *
   * Callers are user-facing flows whose response must not depend on whether the
   * mail server was reachable — both because the user can do nothing about it,
   * and because a difference in behaviour would leak whether an address exists.
   */
  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `\n──────── EMAIL (dev) ────────\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n─────────────────────────────`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, ...message });
      this.logger.log(`Sent "${message.subject}" to ${message.to}`);
    } catch (err) {
      this.logger.error(`Failed to send "${message.subject}": ${String(err)}`);
    }
  }
}
