-- Allow hsk_level to be NULL (words not in HSK curriculum)
alter table vocabulary_mastery
  alter column hsk_level drop not null,
  alter column hsk_level drop default;
