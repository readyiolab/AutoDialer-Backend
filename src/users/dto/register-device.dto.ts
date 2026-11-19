import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  deviceId: string;
}
