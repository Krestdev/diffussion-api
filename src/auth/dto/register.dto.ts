import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'jane.doe@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Str0ngP@ssword' })
  @IsString()
  @MinLength(8)
  password: string;
}
