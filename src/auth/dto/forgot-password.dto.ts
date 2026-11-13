import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail()
  @NormalizeEmail()
  email: string;
}
