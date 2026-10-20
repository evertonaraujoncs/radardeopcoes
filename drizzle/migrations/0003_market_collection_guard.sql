CREATE TABLE public.market_collection_guard (
 key text PRIMARY KEY,
 next_at timestamptz NOT NULL DEFAULT '-infinity',
 lease_id uuid,
 lease_until timestamptz NOT NULL DEFAULT '-infinity',
 attempts integer NOT NULL DEFAULT 0,
 failed_assets integer NOT NULL DEFAULT 0,
 cooldown_level integer NOT NULL DEFAULT 0,
 last_success timestamptz
);
GRANT ALL ON public.market_collection_guard TO service_role;
ALTER TABLE public.market_collection_guard ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.claim_options_collection(p_ticker text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.market_collection_guard; t timestamptz; token uuid;
BEGIN
 INSERT INTO public.market_collection_guard(key) VALUES ('opcoes.net.br') ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.market_collection_guard WHERE key='opcoes.net.br' FOR UPDATE;
 SELECT last_success INTO t FROM public.market_collection_guard WHERE key='ticker:'||p_ticker;
 IF t > clock_timestamp()-interval '4 hours' THEN
  RETURN jsonb_build_object('kind','recent','until',t+interval '4 hours');
 END IF;
 IF greatest(s.next_at,s.lease_until)>clock_timestamp() THEN
  RETURN jsonb_build_object('kind','wait','until',greatest(s.next_at,s.lease_until),'circuit',s.failed_assets>=2);
 END IF;
 token:=gen_random_uuid();
 UPDATE public.market_collection_guard SET lease_id=token,lease_until=clock_timestamp()+interval '5 minutes' WHERE key=s.key;
 RETURN jsonb_build_object('kind','ready','token',token);
END $$;
REVOKE ALL ON FUNCTION public.claim_options_collection(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_options_collection(text) TO service_role;

CREATE FUNCTION public.finish_options_collection(p_ticker text,p_token uuid,p_outcome text,p_retry_seconds double precision DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.market_collection_guard; seconds double precision; failures integer; attempt integer; lvl integer; until_at timestamptz;
BEGIN
 SELECT * INTO s FROM public.market_collection_guard WHERE key='opcoes.net.br' FOR UPDATE;
 IF s.lease_id IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'collection lease expired'; END IF;
 seconds:=30*(0.7+0.6*random()); failures:=s.failed_assets; attempt:=s.attempts; lvl:=s.cooldown_level;
 IF p_outcome='blocked' THEN
  seconds:=least(greatest(greatest(p_retry_seconds,60*power(2,attempt))*(0.8+0.5*random()),p_retry_seconds),greatest(900,p_retry_seconds));
  attempt:=attempt+1;
  IF attempt>=4 THEN failures:=failures+1; attempt:=0; END IF;
  IF failures>=2 THEN
   lvl:=lvl+1;
   seconds:=greatest(seconds,least(360,30*power(2,lvl-1))*60);
   failures:=0;
  END IF;
 ELSIF p_outcome='success' THEN
  failures:=0; attempt:=0; lvl:=0;
  INSERT INTO public.market_collection_guard(key,last_success) VALUES ('ticker:'||p_ticker,clock_timestamp()) ON CONFLICT(key) DO UPDATE SET last_success=excluded.last_success;
 ELSE attempt:=0;
 END IF;
 until_at:=clock_timestamp()+seconds*interval '1 second';
 UPDATE public.market_collection_guard SET lease_id=NULL,lease_until='-infinity',next_at=until_at,attempts=attempt,failed_assets=failures,cooldown_level=lvl WHERE key=s.key;
 RETURN jsonb_build_object('until',until_at,'retry',p_outcome='blocked' AND attempt>0,'circuit',p_outcome='blocked' AND lvl>s.cooldown_level);
END $$;
REVOKE ALL ON FUNCTION public.finish_options_collection(text,uuid,text,double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_options_collection(text,uuid,text,double precision) TO service_role;