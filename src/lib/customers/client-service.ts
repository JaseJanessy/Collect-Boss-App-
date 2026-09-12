import {
  requestJson,
  type ServiceRequestError,
} from "@/lib/data/http-service";
import type {
  CustomerDuplicateResponse,
  CustomerListResponse,
  CustomerRecord,
  CustomerWriteInput,
  CustomerWriteResponse,
} from "./contracts";

export type CustomerServiceError = ServiceRequestError<Partial<CustomerDuplicateResponse>>;

export const customerService = {
  async list(query = ""): Promise<CustomerRecord[]> {
    const result = await requestJson<CustomerListResponse>(
      `/api/debtors?query=${encodeURIComponent(query)}`,
      { cache: "no-store" },
      "Unable to load debtors.",
    );
    return result.debtors;
  },

  async create(input: CustomerWriteInput, allowDuplicate = false): Promise<CustomerRecord> {
    const result = await requestJson<CustomerWriteResponse>(
      "/api/debtors",
      {
        method: "POST",
        body: JSON.stringify({ ...input, ...(allowDuplicate ? { allowDuplicate: true } : {}) }),
      },
      "Unable to save debtor.",
    );
    return result.debtor;
  },

  async update(id: string, input: CustomerWriteInput): Promise<CustomerRecord> {
    const result = await requestJson<CustomerWriteResponse>(
      `/api/debtors/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
      "Unable to save debtor.",
    );
    return result.debtor;
  },

  async setArchived(id: string, archived: boolean): Promise<CustomerRecord> {
    const result = await requestJson<CustomerWriteResponse>(
      `/api/debtors/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify({ archived }) },
      "Unable to update archive status.",
    );
    return result.debtor;
  },
};
