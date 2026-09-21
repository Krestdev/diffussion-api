import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../common/transforms/normalize-email.transform';

export class LoginDto {
  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail()
  @NormalizeEmail()
  email: string;

  @ApiProperty({ example: 'Str0ngP@ssword' })
  @IsString()
  @MinLength(8)
  password: string;
}
