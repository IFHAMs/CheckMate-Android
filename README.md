# CheckMate — offline + archive + seen update

This package keeps the existing CheckMate username/Supabase setup and adds:

- Offline text-message queue using localStorage; queued text sends automatically when internet returns.
- Chat archive per user.
- Chat list with usernames, latest message preview, time, and unread count.
- Seen status using `messages.seen_at`.
- Existing chess, photo/video upload, and camera features remain.

## Supabase migration
Run `offline_archive_seen_migration.sql` in the Supabase SQL Editor **after** the existing `supabase.sql` and `username_migration.sql` migrations.

No existing messages are deleted.

## Important
Offline mode can queue **text** messages. Photos/videos still require internet in this version because they must be uploaded to Supabase Storage.

## Chat upgrades migration
Run `chat_upgrades_migration.sql` once in Supabase SQL Editor after the earlier migrations. It adds last-seen timestamps, message replies, reactions (❤️ 😂 👍), and sender-only message deletion.
Typing indicators use Supabase Realtime Broadcast and do not require another SQL table.