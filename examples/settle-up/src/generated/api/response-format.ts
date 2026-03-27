export interface ResponseEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface MonetaryAmount {
  cents: number;
  currency?: string;
}

export function createSuccessResponse<T>(data: T): ResponseEnvelope<T> {
  return {
    ok: true,
    data,
  };
}

export function createErrorResponse(code: string, message: string): ResponseEnvelope<never> {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  params: PaginationParams
): ResponseEnvelope<PaginatedData<T>> {
  const limit = Math.max(1, params.limit || 20);
  const offset = Math.max(0, params.offset || 0);
  
  return createSuccessResponse({
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  });
}

export function parsePaginationParams(query: Record<string, string | undefined>): PaginationParams {
  const limit = query.limit ? parseInt(query.limit, 10) : undefined;
  const offset = query.offset ? parseInt(query.offset, 10) : undefined;
  
  return {
    limit: limit && limit > 0 ? Math.min(limit, 1000) : undefined,
    offset: offset && offset >= 0 ? offset : undefined,
  };
}

export function formatMonetaryAmount(cents: number, currency = 'USD'): MonetaryAmount {
  if (!Number.isInteger(cents)) {
    throw new Error('Monetary amount must be an integer representing cents');
  }
  
  return {
    cents,
    currency,
  };
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function isResponseEnvelope(obj: unknown): obj is ResponseEnvelope {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  
  const envelope = obj as Record<string, unknown>;
  
  if (typeof envelope.ok !== 'boolean') {
    return false;
  }
  
  if (envelope.error !== undefined) {
    if (typeof envelope.error !== 'object' || envelope.error === null) {
      return false;
    }
    
    const error = envelope.error as Record<string, unknown>;
    if (typeof error.code !== 'string' || typeof error.message !== 'string') {
      return false;
    }
  }
  
  return true;
}

export function validatePaginationParams(params: PaginationParams): void {
  if (params.limit !== undefined) {
    if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 1000) {
      throw new Error('Limit must be an integer between 1 and 1000');
    }
  }
  
  if (params.offset !== undefined) {
    if (!Number.isInteger(params.offset) || params.offset < 0) {
      throw new Error('Offset must be a non-negative integer');
    }
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'b517e8f546c99de3fc504064d309c37cafff62e07f0c0cb70a873fbc12467de4',
  name: 'Response Format',
  risk_tier: 'low',
  canon_ids: [3 as const],
} as const;