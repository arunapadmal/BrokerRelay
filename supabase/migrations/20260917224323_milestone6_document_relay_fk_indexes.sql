
create index if not exists document_delivery_endpoints_user_fk_idx
  on public.document_delivery_endpoints(user_id) where user_id is not null;
create index if not exists document_requests_delivery_endpoint_fk_idx
  on public.document_requests(delivery_endpoint_id) where delivery_endpoint_id is not null;
create index if not exists document_requests_requested_by_fk_idx
  on public.document_requests(requested_by_user_id);
create index if not exists document_transfer_events_actor_fk_idx
  on public.document_transfer_events(actor_user_id) where actor_user_id is not null;
create index if not exists document_transfer_events_org_fk_idx
  on public.document_transfer_events(organisation_id);
create index if not exists document_transfer_events_upload_item_fk_idx
  on public.document_transfer_events(upload_item_id) where upload_item_id is not null;
create index if not exists document_upload_items_client_fk_idx
  on public.document_upload_items(client_id);
create index if not exists document_upload_items_org_fk_idx
  on public.document_upload_items(organisation_id);
;
