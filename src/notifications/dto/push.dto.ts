import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** The keys of a browser's PushSubscription (`subscription.toJSON().keys`). */
export interface PushKeys {
  p256dh: string;
  auth: string;
}

class PushKeysDto implements PushKeys {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  auth!: string;
}

/** This browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export class PushSubscribeDto {
  @IsUrl({ protocols: ['https'], require_tld: false })
  @MaxLength(1000)
  endpoint!: string;

  // Typed with an interface: a nested DTO class type trips the Swagger plugin.
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeys;
}

/** The browser to forget. */
export class PushUnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint!: string;
}

/** « Notifications du navigateur » on or off (console Mon profil). */
export class PushPreferenceDto {
  @IsBoolean()
  enabled!: boolean;
}
