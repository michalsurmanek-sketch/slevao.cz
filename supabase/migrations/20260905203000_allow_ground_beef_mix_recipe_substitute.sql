-- Allow a narrowly-scoped recipe substitute for "Mleté hovězí maso":
-- catalogue offers named "Mleté maso mix" may be considered, while the existing
-- generic "Hovězí maso" guard must continue to reject minced/burger products.
--
-- The patch is replay-safe because production may already contain the complete
-- behavior. A fully-applied definition is a no-op; a partially-applied definition
-- fails closed instead of accepting an ambiguous or broadened matching state.

DO $migration$
DECLARE
  definition text;
  original text;
  has_alias boolean;
  has_guard boolean;
BEGIN
  definition := pg_get_functiondef(
    'public.get_public_shopping_list_candidates(text[],integer)'::regprocedure
  );

  has_alias := position(
    $$when 'mlete hovezi maso' then 'Mleté maso'$$ in definition
  ) > 0;

  has_guard :=
    position(
      $$lower(public.unaccent(rec.ingredient_text)) <> 'mlete hovezi maso'$$ in definition
    ) > 0
    and position(
      $$s.candidate_text ~ '(^| )mlet[a-z]*( |$)'$$ in definition
    ) > 0
    and position(
      $$s.candidate_text ~ '(^| )maso( |$)'$$ in definition
    ) > 0
    and position(
      $$s.candidate_text ~ '(^| )(mix|smes)[a-z]*( |$)'$$ in definition
    ) > 0
    and position(
      $$s.candidate_text !~ '(^| )(kurec|kruti|kachn|jehne|ryb)[a-z]*( |$)'$$ in definition
    ) > 0;

  IF has_alias OR has_guard THEN
    IF has_alias AND has_guard THEN
      RAISE NOTICE 'Ground-beef recipe substitute is already fully applied; skipping replay';
    ELSE
      RAISE EXCEPTION 'Ground-beef recipe substitute is only partially applied';
    END IF;
  ELSE
    original := definition;
    definition := replace(
      definition,
      $$          when 'hovezi maso' then 'Hovězí zadní'
          when 'hladka mouka' then 'Pšeničná mouka'$$,
      $$          when 'hovezi maso' then 'Hovězí zadní'
          when 'mlete hovezi maso' then 'Mleté maso'
          when 'hladka mouka' then 'Pšeničná mouka'$$
    );

    IF definition = original THEN
      RAISE EXCEPTION 'Expected ground-beef recipe alias fragment was not found';
    END IF;

    original := definition;
    definition := replace(
      definition,
      $$        and (lower(public.unaccent(rec.ingredient_text)) <> 'hovezi maso' or s.candidate_text !~ '(mlet|meln|burger|tatarak)')
        and (lower(public.unaccent(rec.ingredient_text)) <> 'hladka mouka' or ($$,
      $$        and (lower(public.unaccent(rec.ingredient_text)) <> 'hovezi maso' or s.candidate_text !~ '(mlet|meln|burger|tatarak)')
        and (
          lower(public.unaccent(rec.ingredient_text)) <> 'mlete hovezi maso'
          or (
            s.candidate_text ~ '(^| )mlet[a-z]*( |$)'
            and s.candidate_text ~ '(^| )maso( |$)'
            and s.candidate_text !~ '(^| )(kurec|kruti|kachn|jehne|ryb)[a-z]*( |$)'
            and (
              s.candidate_text ~ '(^| )hovez[a-z]*( |$)'
              or s.candidate_text ~ '(^| )(mix|smes)[a-z]*( |$)'
            )
          )
        )
        and (lower(public.unaccent(rec.ingredient_text)) <> 'hladka mouka' or ($$
    );

    IF definition = original THEN
      RAISE EXCEPTION 'Expected ground-beef semantic guard fragment was not found';
    END IF;

    EXECUTE definition;
  END IF;
END
$migration$;
