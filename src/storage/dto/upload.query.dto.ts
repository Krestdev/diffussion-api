import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadQueryDto {
  @ApiPropertyOptional({
    example: 'courriers/2026/08',
    description: 'Folder-like key prefix to store the file under',
  })
  @IsOptional()
  @IsString()
  prefix?: string;
}
