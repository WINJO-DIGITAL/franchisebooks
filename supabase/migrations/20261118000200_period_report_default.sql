-- Automatic reports follow DPD's four-week pay periods, not calendar months. The report for a period is made on the
-- Monday after it ends (the Sunday is the last day), once that day's figures have synced.
alter table public.app_settings alter column report_frequency set default 'dpd_period';

update public.app_settings set report_frequency = 'dpd_period' where report_frequency = 'monthly';
