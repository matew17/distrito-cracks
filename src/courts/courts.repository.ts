import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';

/**
 * A Court together with its weekly operating-hours rows. A missing row for a
 * given weekday means the court is closed that day (data-model.md).
 */
export type CourtWithOperatingHours = Prisma.CourtGetPayload<{
  include: { operatingHours: true };
}>;

@Injectable()
export class CourtsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a court by id including its operating hours, or `null` if no such
   * court exists.
   */
  findByIdWithOperatingHours(
    id: string,
  ): Promise<CourtWithOperatingHours | null> {
    return this.prisma.court.findUnique({
      where: { id },
      include: { operatingHours: true },
    });
  }
}
