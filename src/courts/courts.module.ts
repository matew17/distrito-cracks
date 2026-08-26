import { Module } from '@nestjs/common';
import { CourtsRepository } from './courts.repository';
import { CourtsService } from './courts.service';

/**
 * Court management (CRUD) is out of scope for this feature — no controller
 * here. `CourtsService` is exported so `ReservationsModule` can query
 * bookability and operating hours.
 */
@Module({
  providers: [CourtsRepository, CourtsService],
  exports: [CourtsService],
})
export class CourtsModule {}
