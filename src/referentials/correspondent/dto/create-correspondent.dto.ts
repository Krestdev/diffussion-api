import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CorrespondentStatus } from 'generated/prisma/enums';

export class CreateCorrespondentDto {
  @ApiProperty({ example: 'Mairie de Yaoundé' })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ description: 'CorrespondentType id' })
  @IsOptional()
  @IsUUID()
  typeId?: string;

  @ApiPropertyOptional({ example: 'Avenue Kennedy' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Yaoundé' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'Cameroun' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ example: 'contact@krestholding.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @ApiPropertyOptional({ example: '+237697568784' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'Patrick SONGO' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  mainContact?: string;

  @ApiPropertyOptional({
    enum: CorrespondentStatus,
    default: CorrespondentStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(CorrespondentStatus)
  status?: CorrespondentStatus;
}
