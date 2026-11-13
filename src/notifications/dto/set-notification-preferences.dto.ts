import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { NOTIFICATION_TYPES } from '../notification-types';

export class NotificationPreferenceDto {
  @ApiProperty({ enum: Object.keys(NOTIFICATION_TYPES) })
  @IsIn(Object.keys(NOTIFICATION_TYPES))
  type: string;

  @ApiProperty({ description: 'false: no longer receive this notification' })
  @IsBoolean()
  enabled: boolean;
}

export class SetNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  preferences: NotificationPreferenceDto[];
}
