# Business Rules — Distrito Cracks

Stable IDs. Never renumber. Deprecate instead.

| ID    | Rule                                                          | Enforced at                      |
| ----- | ------------------------------------------------------------- | -------------------------------- |
| BR-01 | No two active bookings may overlap on the same field          | DB constraint + integration test |
| BR-02 | Duration: min 60 min, max 180 min, in 30 min blocks           | DTO + unit test                  |
| BR-03 | Booking must fall within the field's operating hours          | Service + unit test              |
| BR-04 | Free cancellation up to 24h before start; after that, penalty | Service + unit test              |
| BR-05 | Max 3 active bookings per user                                | Service + integration test       |
| BR-06 | Cannot book a slot in the past                                | DTO + unit test                  |
| BR-07 | A field under maintenance accepts no bookings                 | Service + unit test              |
| BR-08 | Only the user who owns a booking may cancel it                | Service + integration test       |
| BR-09 | A booking may only be cancelled from an active status         | Service + unit test              |
| BR-10 | A booking whose start time has passed cannot be cancelled     | Service + unit test              |

## Open questions

- BR-04: is the penalty a fixed amount or a percentage? What happens if the
  slot was already re-booked by someone else?
