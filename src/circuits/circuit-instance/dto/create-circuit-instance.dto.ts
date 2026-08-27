import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CreateCircuitInstanceDto {
  @ApiPropertyOptional({
    description:
      'Explicit circuit template to use. If omitted, resolved from the ' +
      "target's dossier type — there must be exactly one Circuit " +
      'configured for that DossierType.',
  })
  @IsOptional()
  @IsUUID()
  circuitId?: string;

  @ApiPropertyOptional({
    description:
      'The courrier to attach this circuit to. A circuit attaches to a ' +
      'courrier or a document, never a bare dossier — provide this or ' +
      'documentId, not a dossierId.',
  })
  @IsOptional()
  @IsUUID()
  courrierId?: string;

  @ApiPropertyOptional({
    description:
      'The document to attach this circuit to, when it is the document ' +
      'itself being reviewed rather than a courrier.',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;
}
