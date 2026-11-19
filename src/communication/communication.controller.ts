import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CommunicationService } from './communication.service';
import { CreateTemplateDto, SendMessageDto } from './dto/communication.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Communication')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('communication')
export class CommunicationController {
  constructor(private readonly communicationService: CommunicationService) {}

  @Get('templates')
  @ApiOperation({ summary: 'Get WhatsApp and SMS templates' })
  getTemplates(@Query('type') type: any, @CurrentUser() user: any) {
    return this.communicationService.getTemplates(user.companyId, type);
  }

  @Post('templates')
  @ApiOperation({ summary: 'Create a new WhatsApp / SMS template' })
  createTemplate(@Body() dto: CreateTemplateDto, @CurrentUser() user: any) {
    return this.communicationService.createTemplate(dto, user.companyId);
  }

  @Patch('templates/:id')
  @ApiOperation({ summary: 'Update template' })
  updateTemplate(
    @Param('id') id: string,
    @Body() dto: Partial<CreateTemplateDto>,
    @CurrentUser() user: any,
  ) {
    return this.communicationService.updateTemplate(id, dto, user.companyId);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send direct WhatsApp or SMS to a customer' })
  sendMessage(@Body() dto: SendMessageDto, @CurrentUser() user: any) {
    return this.communicationService.sendMessage(dto, user.userId, user.companyId);
  }

  @Get('history')
  @ApiOperation({ summary: 'View sent communication log and delivery reports' })
  getHistory(@Query() query: any, @CurrentUser() user: any) {
    return this.communicationService.getHistory({ ...query, companyId: user.companyId });
  }
}
