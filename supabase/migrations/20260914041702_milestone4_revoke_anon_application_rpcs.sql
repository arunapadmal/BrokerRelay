revoke execute on function public.create_loan_application(uuid, text, public.application_status, date, text) from anon;
revoke execute on function public.update_loan_application_status(uuid, public.application_status, date, text) from anon;
revoke execute on function public.update_loan_application_reference(uuid, text) from anon;;
