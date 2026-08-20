import { Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MailService } from './mail.service';

export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post()
  createMail() {
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
