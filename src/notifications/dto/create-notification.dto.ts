import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NotificationCanal } from 'generated/prisma/enums';

export class CreateNotificationDto {
  @ApiProperty({
    type: [String],
    description: 'RG-NOT-003: may fan out to several recipients at once',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
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
}
