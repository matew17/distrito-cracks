-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "underMaintenance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Reservation" ALTER COLUMN "status" SET DEFAULT 'CONFIRMED';

-- CreateTable
CREATE TABLE "CourtOperatingHour" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opensAt" INTEGER NOT NULL,
    "closesAt" INTEGER NOT NULL,

    CONSTRAINT "CourtOperatingHour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourtOperatingHour_courtId_dayOfWeek_key" ON "CourtOperatingHour"("courtId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "CourtOperatingHour" ADD CONSTRAINT "CourtOperatingHour_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CourtOperatingHour range checks.
ALTER TABLE "CourtOperatingHour"
  ADD CONSTRAINT "CourtOperatingHour_dayOfWeek_check"
  CHECK ("dayOfWeek" BETWEEN 0 AND 6);

ALTER TABLE "CourtOperatingHour"
  ADD CONSTRAINT "CourtOperatingHour_hours_check"
  CHECK ("opensAt" >= 0 AND "closesAt" <= 1440 AND "opensAt" < "closesAt");

-- BR-01: no two active reservations overlap on the same court.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_no_overlap_per_court"
  EXCLUDE USING gist (
    "courtId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE ("status" <> 'CANCELLED');

-- BR-02: duration 60-180 minutes, in whole 30-minute blocks. Duration only —
-- the start instant is unconstrained. Compared in milliseconds so no rounding
-- can let a near-30-minute duration pass as an exact one.
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_duration_valid"
  CHECK (
    "endTime" > "startTime"
    AND (EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000)::bigint
        BETWEEN 3600000 AND 10800000
    AND MOD((EXTRACT(EPOCH FROM ("endTime" - "startTime")) * 1000)::bigint, 1800000) = 0
  );
