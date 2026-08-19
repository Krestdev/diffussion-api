import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { UseGuards } from '@nestjs/common';
import { CreateInstructionsDto } from './dto/create-instruction.dto';
import { UpdateInstructionDto } from './dto/update-instruction.dto';

@ApiTags('instructions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('instructions')
export class InstructionsController {
  constructor(private readonly instructionsService: InstructionsService) {}

  @Post()
  create(@Body() dto: CreateInstructionsDto) {
    return 'create instruction';
  }

  @Post('assigne')
  assigne(@Body() dto: CreateInstructionsDto) {
    return 'assigne instruction';
  }

  @Patch('accept/:id')
  accept(@Param('id') id: string) {
    return 'accept instruction';
  }
  @Patch('refuse/:id')
  refuse(@Param('id') id: string) {
    return 'refuse instruction';
  }

  @Patch('close/:id')
  close(@Param('id') id: string) {
    return 'close instruction';
  }
}
