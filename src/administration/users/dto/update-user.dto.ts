import { ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {
  @ApiPropertyOptional({
    description: 'Only set to change the password',
    example: 'N3wStr0ngP@ssword',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
