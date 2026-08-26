import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CourtsModule } from '../courts/courts.module';

@Module({
  imports: [PrismaModule, CourtsModule],
  controllers: [],
  providers: [],
})
export class ReservationsModule {}
