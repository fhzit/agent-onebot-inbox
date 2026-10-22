# Contacts and target resolution

`src/contacts-cache.ts` holds per-account in-memory friend/group/member snapshots and can feed the exact resolver in `src/contact-resolver.ts`. It is not yet integrated with provider calls or persistence.
A match is scoped to the requested account (when supplied) and compares QQ ID, nickname, remark, and group card case-insensitively. Multiple exact matches return `ambiguous` with candidate records; the resolver never selects one implicitly.

The resolver currently uses fixture/contact records passed by the caller. It is not yet backed by a database, connected to OneBot friend/group sync, or wired into send routes. Approximate/fuzzy matching is intentionally excluded so it cannot silently choose the wrong recipient.
