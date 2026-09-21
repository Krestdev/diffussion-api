import { Injectable, Logger } from '@nestjs/common';

export interface PasswordResetMail {
  to: string;
  name: string;
  resetLink: string;
  expiresAt: Date;
}

/**
 * Outbound mail port. Injected by its abstract class, so swapping delivery
 * is a one-line provider change in MailModule:
 *
 *   { provide: MailerService, useClass: SmtpMailerService }
 *
 * A real implementation only has to extend this class and implement the
 * methods — nothing else in the app changes.
 */
@Injectable()
export abstract class MailerService {
  abstract sendPasswordReset(mail: PasswordResetMail): Promise<void>;
}

/**
 * Default implementation: logs the message instead of sending it. Lets the
 * whole reset flow run end to end in development — the link is printed in
 * the API logs. NOT suitable for production: nothing reaches the user.
 */
@Injectable()
export class LogMailerService extends MailerService {
  private readonly logger = new Logger(LogMailerService.name);

  sendPasswordReset(mail: PasswordResetMail): Promise<void> {
    this.logger.warn(
      `[no mailer configured] Password reset for ${mail.to} — link valid until ${mail.expiresAt.toISOString()}: ${mail.resetLink}`,
    );
    return Promise.resolve();
  }
}
