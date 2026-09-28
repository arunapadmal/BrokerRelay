
drop policy if exists document_upload_items_server_only on public.document_upload_items;
create policy document_upload_items_server_only
on public.document_upload_items
for all
to authenticated
using (false)
with check (false);

drop policy if exists document_transfer_events_server_only on public.document_transfer_events;
create policy document_transfer_events_server_only
on public.document_transfer_events
for all
to authenticated
using (false)
with check (false);
;
