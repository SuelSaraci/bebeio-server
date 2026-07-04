/** Normalize DB date values to yyyy-MM-dd for JSON responses. */
export const formatDateOnly = (value) => {
  if (value == null) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};
