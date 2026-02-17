
-- Ground handling providers (simplified)
CREATE TABLE public.ground_handling_providers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  icao TEXT,
  country TEXT,
  website TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ground handling quotes
CREATE TABLE public.ground_handling_quotes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id UUID REFERENCES public.ground_handling_providers(id) ON DELETE SET NULL,
  icao TEXT NOT NULL,
  airport_name TEXT,
  country TEXT,
  aircraft_type TEXT,
  aircraft_registration TEXT,
  mtow_kg NUMERIC,
  arrival_date DATE,
  arrival_time TEXT,
  departure_date DATE,
  departure_time TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  subtotal NUMERIC,
  vat_total NUMERIC,
  grand_total NUMERIC,
  quote_reference TEXT,
  quote_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ground handling line items
CREATE TABLE public.ground_handling_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id UUID NOT NULL REFERENCES public.ground_handling_quotes(id) ON DELETE CASCADE,
  service_category TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  vat_rate NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ground_handling_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ground_handling_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ground_handling_line_items ENABLE ROW LEVEL SECURITY;

-- Public read/write policies (no auth required for this internal tool)
CREATE POLICY "Allow public read providers" ON public.ground_handling_providers FOR SELECT USING (true);
CREATE POLICY "Allow public insert providers" ON public.ground_handling_providers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update providers" ON public.ground_handling_providers FOR UPDATE USING (true);

CREATE POLICY "Allow public read quotes" ON public.ground_handling_quotes FOR SELECT USING (true);
CREATE POLICY "Allow public insert quotes" ON public.ground_handling_quotes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update quotes" ON public.ground_handling_quotes FOR UPDATE USING (true);
CREATE POLICY "Allow public delete quotes" ON public.ground_handling_quotes FOR DELETE USING (true);

CREATE POLICY "Allow public read line_items" ON public.ground_handling_line_items FOR SELECT USING (true);
CREATE POLICY "Allow public insert line_items" ON public.ground_handling_line_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update line_items" ON public.ground_handling_line_items FOR UPDATE USING (true);
CREATE POLICY "Allow public delete line_items" ON public.ground_handling_line_items FOR DELETE USING (true);

-- Updated-at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_ground_handling_providers_updated_at
  BEFORE UPDATE ON public.ground_handling_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ground_handling_quotes_updated_at
  BEFORE UPDATE ON public.ground_handling_quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
