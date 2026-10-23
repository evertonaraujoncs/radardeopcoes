CREATE OR REPLACE FUNCTION public.claim_options_collection(p_ticker text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.market_collection_guard; t timestamptz; token uuid;
BEGIN
 INSERT INTO public.market_collection_guard(key) VALUES ('opcoes.net.br') ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.market_collection_guard WHERE key='opcoes.net.br' FOR UPDATE;
 SELECT last_success INTO t FROM public.market_collection_guard WHERE key='ticker:'||p_ticker;
 IF t > clock_timestamp()-interval '20 minutes' THEN RETURN jsonb_build_object('kind','recent','until',t+interval '20 minutes'); END IF;
 IF greatest(s.next_at,s.lease_until)>clock_timestamp() THEN
  RETURN jsonb_build_object('kind','wait','until',greatest(s.next_at,s.lease_until),'circuit',s.cooldown_level>0);
 END IF;
 token:=gen_random_uuid();
 UPDATE public.market_collection_guard SET lease_id=token,lease_until=clock_timestamp()+interval '5 minutes' WHERE key=s.key;
 RETURN jsonb_build_object('kind','ready','token',token);
END $$;
REVOKE ALL ON FUNCTION public.claim_options_collection(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_options_collection(text) TO service_role;