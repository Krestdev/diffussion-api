import {
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { MailService } from './mail.service';

@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post()
  createMail() {
    Logger.debug('create mail');
    return 'create mail';
  }

  @Get()
  findAllMail() {
    return 'find all mail';
  }

  @Get(':id')
  findMailById(@Param('id') id: string) {
    return 'find mail by id';
  }

  @Patch(':id')
  updateMail(@Param('id') id: string) {
    return 'update mail';
  }

  @Delete(':id')
  deleteMail(@Param('id') id: string) {
    return 'delete mail';
  }
}
