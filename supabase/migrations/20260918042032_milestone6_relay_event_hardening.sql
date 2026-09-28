
alter table public.document_transfer_events
  drop constraint if exists document_transfer_events_event_type_check;

alter table public.document_transfer_events
  add constraint document_transfer_events_event_type_check
  check (event_type in (
    'request_created','upload_ticket_created','upload_started','upload_completed',
    'validation_passed','validation_failed','scan_passed','scan_failed',
    'relay_started','relay_accepted','relay_failed',
    'purge_completed','purge_failed','request_cancelled'
  ));
;
