# Legacy Feature Map

This map keeps the rewrite honest. The legacy Laravel project remains the
behavioural reference, while cspot-pro uses clearer module boundaries.

| Legacy capability | Legacy area | New module | First target |
| --- | --- | --- | --- |
| Users, roles, role rights | `users`, `roles`, `role_user` | `identity` | Local auth, first-admin bootstrap, role policies |
| Social logins | `social_logins`, Socialite controllers | `identity` | Provider adapter boundary |
| Plan calendar and next service | `PlanController` | `planning` | Plan list, calendar, next plan |
| Running order items | `ItemController` | `planning` | Ordered item CRUD and soft delete |
| Plan notes and item notes | `notes`, `item_notes` | `planning` | Notes with read markers |
| Default plan items | `default_items` | `planning` | Templates per plan type |
| Songs, lyrics, chords | `SongController`, `songs` | `music` | Song library CRUD and search |
| OnSong sections/files | `on_songs`, song upload routes | `music` | OnSong import/export and section editor |
| Sheet music and attachments | `files`, `file_item` | `library` | Upload storage and linking |
| Teams and instruments | `plan_team`, `instruments` | `people` | Working assignment CRUD, status, instrument selection |
| Resources | `resources`, `plan_resource` | `library` | Working resource CRUD and plan-resource assignment |
| Bible references/text | `bibleversions`, `biblebooks`, `bibles` | `library` | Working seeded passage lookup; broader import still needed |
| Presentation and sync | presentation routes, `plan_caches` | `presentation` | Working projector-style preview; sync/cache still needed |
| Internal messages | messenger tables/routes | `communication` | Working threads and replies |
| Email reminders | mailers/jobs | `communication` | Queue-backed notification adapters |
| History/audit trail | `histories` | `planning` | Entity event log |
| Customization/admin | admin controllers | cross-module admin | User admin working; settings/reference maintenance still needed |

## Build Order

1. Database models and migrations for the full legacy domain.
2. Plan and song CRUD APIs.
3. Plan editor UI with running order and song picker.
4. Team/resource assignment.
5. Presentation mode and controller sync.
6. File uploads, OnSong, Bible lookup, and lyrics import.
7. Messaging, reminders, admin hardening, and migration scripts from legacy data.
