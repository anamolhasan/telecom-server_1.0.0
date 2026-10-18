-- Remove the deprecated Specialty taxonomy. No other table references
-- "specialties" (no foreign keys), so dropping it is referentially safe and
-- does not affect any other table or data.
DROP TABLE "specialties";
