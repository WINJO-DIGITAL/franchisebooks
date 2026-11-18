-- The vehicle a franchise runs (type, size, fuel). DPD's sliding scale pays a different rate per stop by vehicle, so
-- knowing it lets the app check each day's actual stop rate against the scale. All optional.

alter table public.franchises
  add column if not exists vehicle_type text check (vehicle_type is null or length(btrim(vehicle_type)) between 1 and 80),
  add column if not exists vehicle_size text check (vehicle_size is null or length(vehicle_size) <= 80),
  add column if not exists vehicle_fuel text check (vehicle_fuel is null or vehicle_fuel in ('diesel', 'electric', 'other'));

comment on column public.franchises.vehicle_type is 'Vehicle type as the DPD sliding scale names it, for example Van.';
