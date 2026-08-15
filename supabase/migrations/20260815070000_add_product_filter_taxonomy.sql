alter table public.products
  add column if not exists filter_group text,
  add column if not exists filter_tags text[] not null default '{}'::text[],
  add column if not exists content_form text,
  add column if not exists classification_confidence numeric(4,3),
  add column if not exists classification_source text,
  add column if not exists classified_at timestamptz;

alter table public.products
  drop constraint if exists products_classification_confidence_check,
  add constraint products_classification_confidence_check
    check (classification_confidence is null or classification_confidence between 0 and 1);

create index if not exists products_filter_group_idx
  on public.products (filter_group)
  where filter_group is not null;

create index if not exists products_filter_tags_gin_idx
  on public.products using gin (filter_tags)
  where cardinality(filter_tags) > 0;

comment on column public.products.filter_group is
  'Canonical UI filter group assigned during import or manual review.';
comment on column public.products.filter_tags is
  'Canonical searchable filter tags, independent of product title wording.';
comment on column public.products.content_form is
  'Product form such as fresh, frozen, drink, processed or household.';
comment on column public.products.classification_confidence is
  'Classification confidence from 0 to 1.';
comment on column public.products.classification_source is
  'Classifier source such as deterministic_rule, importer or manual.';
