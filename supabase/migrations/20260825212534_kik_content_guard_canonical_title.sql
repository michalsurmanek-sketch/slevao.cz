CREATE OR REPLACE FUNCTION private.kik_structured_rows_match_published_set(p_rows jsonb, p_store_id uuid, p_adapter text, p_count integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = 'public', 'private', 'pg_temp'
AS $function$
WITH expected AS MATERIALIZED (
  SELECT
    trim(coalesce(x->>'external_id','')) AS external_id,
    trim(coalesce(x->>'title','')) AS title,
    public.normalize_product_name(trim(coalesce(x->>'title',''))) AS normalized_title,
    nullif(x->>'price','')::numeric AS price,
    nullif(x->>'old_price','')::numeric AS old_price,
    nullif(x->>'valid_from','')::date AS valid_from,
    nullif(x->>'valid_to','')::date AS valid_to,
    nullif(trim(coalesce(x->>'source_url','')),'') AS source_url,
    greatest(0.50,least(1,coalesce(nullif(x->>'confidence','')::numeric,0.95))) AS confidence
  FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
), published_count AS (
  SELECT count(*)::integer AS n
  FROM public.offers o
  WHERE o.store_id=p_store_id AND o.status='published'
), exact_matches AS (
  SELECT count(*)::integer AS n
  FROM expected e
  JOIN public.offers o ON o.store_id=p_store_id
   AND o.status='published'
   AND o.external_id=e.external_id
   AND o.title=e.title
   AND o.normalized_title=e.normalized_title
   AND o.price=e.price
   AND o.old_price IS NOT DISTINCT FROM CASE WHEN e.old_price IS NOT NULL AND e.old_price>e.price THEN e.old_price ELSE NULL END
   AND o.valid_from=e.valid_from
   AND o.valid_to=e.valid_to
   AND o.source_url IS NOT DISTINCT FROM e.source_url
   AND o.is_verified=(e.confidence>=0.90)
   AND o.confidence_score=e.confidence
   AND coalesce(o.metadata->>'adapter','')=p_adapter
)
SELECT jsonb_array_length(coalesce(p_rows,'[]'::jsonb))=p_count
   AND coalesce((SELECT n FROM published_count),0)=p_count
   AND coalesce((SELECT n FROM exact_matches),0)=p_count;
$function$;

REVOKE ALL ON FUNCTION private.kik_structured_rows_match_published_set(jsonb,uuid,text,integer) FROM public, anon, authenticated;
