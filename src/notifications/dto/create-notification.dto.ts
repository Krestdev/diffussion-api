import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NotificationCanal } from '../../generated/prisma/enums';

export class CreateNotificationDto {
  @ApiProperty({
    type: [String],
    description: 'RG-NOT-003: may fan out to several recipients at once',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  recipientIds: string[];

  @ApiProperty({ example: 'INSTRUCTION_OVERDUE' })
  @IsString()
  @MaxLength(50)
  type: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({ enum: NotificationCanal, default: NotificationCanal.IN_APP })
  @IsEnum(NotificationCanal)
  canal: NotificationCanal;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  courrierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  instructionId?: string;

  /**
   * What the sentence is made of ({reason}, {date}, {actor}…), so each reader sees it in their
   * language (notification-texts.ts). The effet's {number} and {subject} and the task's {title}
   * are added from courrierId / instructionId.
   */
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  params?: Record<string, string>;
}
