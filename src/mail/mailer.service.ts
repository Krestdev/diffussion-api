import { Injectable, Logger } from '@nestjs/common';

export interface SupportMail {
  kind: 'ticket' | 'reply';
  /** The support team's address. */
  to: string;
  /** The requester's copy. */
  copyTo: string;
  number: string;
  subject: string;
  body: string;
  from: string;
}

/**
 * Outbound mail port. Injected by its abstract class, so swapping delivery
 * is a one-line provider change in MailModule:
 *
 *   { provide: MailerService, useClass: SmtpMailerService }
 *
 * A real implementation only has to extend this class and implement the
 * methods — nothing else in the app changes. Password resets and
 * invitations are sent by the CREAPP core.
 */
@Injectable()
export abstract class MailerService {
  abstract sendSupport(mail: SupportMail): Promise<void>;
}

/**
 * Default implementation: logs the message instead of sending it. NOT
 * suitable for production: nothing reaches the user.
 */
@Injectable()
export class LogMailerService extends MailerService {
  private readonly logger = new Logger(LogMailerService.name);

  sendSupport(mail: SupportMail): Promise<void> {
    this.logger.warn(
      `[no mailer configured] Support ${mail.kind} ${mail.number} for ${mail.to}, copy to ${mail.copyTo}`,
    );
    return Promise.resolve();
  }
}
