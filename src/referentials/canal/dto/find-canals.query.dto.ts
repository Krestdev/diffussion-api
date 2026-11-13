import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class FindCanalsQueryDto {
  @ApiPropertyOptional({
    description:
      "Only the canaux of this site (a platform administrator; anyone else only ever sees their own site's)",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional({ description: 'true: the active ones only' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}
