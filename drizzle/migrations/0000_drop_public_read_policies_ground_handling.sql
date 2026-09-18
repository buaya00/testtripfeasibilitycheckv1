DO $$
DECLARE
  extra_count int;
  expected_count int;
BEGIN
  SELECT count(*) INTO extra_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('ground_handling_providers','ground_handling_quotes','ground_handling_line_items')
    AND policyname NOT IN ('Allow public read providers','Allow public read quotes','Allow public read line_items');
  IF extra_count > 0 THEN
    RAISE EXCEPTION 'Unexpected policies present on ground handling tables: %', extra_count;
  END IF;

  SELECT count(*) INTO expected_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('ground_handling_providers','ground_handling_quotes','ground_handling_line_items')
    AND cmd = 'SELECT' AND qual = 'true';
  IF expected_count <> 3 THEN
    RAISE EXCEPTION 'Expected exactly 3 public SELECT policies, found %', expected_count;
  END IF;
END $$;

DROP POLICY "Allow public read providers" ON public.ground_handling_providers;
DROP POLICY "Allow public read quotes" ON public.ground_handling_quotes;
DROP POLICY "Allow public read line_items" ON public.ground_handling_line_items;
