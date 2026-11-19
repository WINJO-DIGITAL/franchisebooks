-- DPD's figures are the franchise's income. A driver's pay comes only from the pay rate set for them, never from a DPD figure.
alter table public.app_settings alter column earnings_meaning set default 'route_income';
update public.app_settings set earnings_meaning = 'route_income' where earnings_meaning <> 'route_income';
