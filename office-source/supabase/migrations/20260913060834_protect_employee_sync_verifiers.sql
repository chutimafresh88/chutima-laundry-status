begin;
-- Employee synchronization contains offline password verifiers: only SERVERJJ's service can read it.
create policy central_employee_sync_private on public.inventory_central_requests as restrictive
for all to authenticated
using (coalesce(payload->>'workflow','') <> 'employee.save')
with check (coalesce(payload->>'workflow','') <> 'employee.save');
commit;
