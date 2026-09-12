export const businessExportDatasets = [
  "customers",
  "accounts",
  "cases",
  "invoices",
  "payments",
  "activities",
  "statements",
] as const;

export type BusinessExportDataset = (typeof businessExportDatasets)[number];

const allowedDatasets = new Set<string>(businessExportDatasets);

export function normalizeExportDatasets(value: unknown): BusinessExportDataset[] {
  if (value === undefined || value === null) return [...businessExportDatasets];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Choose at least one export dataset.");
  }

  const datasets = [...new Set(value)];
  if (datasets.some((item) => typeof item !== "string" || !allowedDatasets.has(item))) {
    throw new Error("One or more requested export datasets are not supported.");
  }
  return businessExportDatasets.filter((dataset) => datasets.includes(dataset));
}
