import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class DocumentService {
  constructor(private readonly database: DatabaseService) {}
}
