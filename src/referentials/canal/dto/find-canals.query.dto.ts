import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class FindCanalsQueryDto {
  @ApiPropertyOptional({
    description:
      "Only the canaux of this company (one only ever sees their own company's: another gives nothing)",
  })
  @IsOptional()
  @IsUUID('all')
  companyId?: string;

  @ApiPropertyOptional({ description: 'true: the active ones only' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}
