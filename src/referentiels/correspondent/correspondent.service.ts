import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class CorrespondantService {
  constructor(private readonly database: DatabaseService) {}
}
