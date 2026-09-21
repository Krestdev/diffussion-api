import { Global, Module } from '@nestjs/common';
import { LogMailerService, MailerService } from './mailer.service';

// Global so any module can inject MailerService without re-importing this
// one. Swap `useClass` here to plug real delivery in (SMTP, provider API).
@Global()
@Module({
  providers: [{ provide: MailerService, useClass: LogMailerService }],
  exports: [MailerService],
})
export class MailModule {}
