import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSupportTicketDto {
  @ApiProperty({ example: 'BUG' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject!: string;

  @ApiProperty({ example: 'NORMALE' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  priority!: string;

  @ApiPropertyOptional({ description: 'The page it concerns' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  page?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description!: string;

  @ApiPropertyOptional({
    description: 'Browser, version... JSON, or plain text',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  technicalInfo?: string;
}

export class CreateSupportMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body!: string;
}

export class HelpFeedbackDto {
  @ApiProperty({ example: 'dispatcher-un-effet' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  slug!: string;

  @ApiProperty()
  @IsBoolean()
  helpful!: boolean;
}
