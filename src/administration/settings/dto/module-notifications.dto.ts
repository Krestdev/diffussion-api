import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { NOTIFICATION_TYPES } from '../../../notifications/notification-types';

const TYPES = Object.keys(NOTIFICATION_TYPES);

export class ModuleNotificationEventDto {
  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  type: string;

  @ApiPropertyOptional({ description: 'Shown in the application (the bell)' })
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @ApiPropertyOptional({ description: 'Sent by email' })
  @IsOptional()
  @IsBoolean()
  email?: boolean;
}

export class UpdateModuleNotificationsDto {
  @ApiPropertyOptional({
    description:
      "This company's. Left out: the caller's company when they manage only one; the common ones for a platform administrator",
  })
  @IsOptional()
  @IsUUID('4')
  companyId?: string;

  @ApiPropertyOptional({ type: [ModuleNotificationEventDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ModuleNotificationEventDto)
  events?: ModuleNotificationEventDto[];

  @ApiPropertyOptional({
    description: 'A company gives its own up, to inherit the common ones again',
  })
  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}
