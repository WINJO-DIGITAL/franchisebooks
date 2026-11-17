-- Reports can cover a DPD four-week period instead of a calendar month.
-- report_month stays as the month the period starts in (used for ordering); the real range is period_start..period_end.
alter table public.monthly_reports
  add column period_start date,
  add column period_end date,
  add constraint monthly_reports_period_ok check ((period_start is null) = (period_end is null) and (period_start is null or period_end >= period_start));

comment on column public.monthly_reports.period_start is 'Start of the DPD four-week period this report covers; null for a calendar-month report.';

-- How often automatic reports are made: each calendar month, or each DPD four-week period.
alter table public.app_settings
  add column report_frequency text not null default 'monthly' check (report_frequency in ('monthly', 'dpd_period'));

comment on column public.app_settings.report_frequency is 'monthly = one report after each calendar month; dpd_period = one after each DPD four-week period.';
